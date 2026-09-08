<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { Icon } from '@iconify/vue';

export interface PullToRefreshOptions {
  pullThreshold?: number;
  minSwipeDistance?: number;
  refreshText?: string;
  pullingText?: string;
  releaseText?: string;
}

interface Props {
  onRefresh: () => Promise<void>;
  enabled?: boolean;
  options?: PullToRefreshOptions;
}

const props = withDefaults(defineProps<Props>(), {
  enabled: true,
  options: () => ({
    pullThreshold: 70,
    minSwipeDistance: 15,
    refreshText: 'Refreshing...',
    pullingText: 'Pull down to refresh',
    releaseText: 'Release to refresh',
  }),
});

// Pull to refresh state
const containerRef = ref<HTMLElement | null>(null);
const isPulling = ref(false);
const refreshProgress = ref(0);
const isRefreshing = ref(false);
const pullStartY = ref(0);
const pullContentOffset = ref(0);
const isAtTop = ref(false);
const wasAtTop = ref(false); // Track if page was already at top when touch started
const touchInitialDirection = ref<'up' | 'down' | null>(null); // Track initial touch direction

// Animation control
let touchStartY = 0;
let lastTouchY = 0; // Track the last touch Y position to determine direction
let animationFrameId: number | null = null;

// Check if the container is at the top of its scroll area
const checkIfAtTop = () => {
  if (!containerRef.value) return false;
  return containerRef.value.scrollTop <= 0;
};

// Handle container scroll events
const handleContainerScroll = () => {
  const atTop = checkIfAtTop();
  if (atTop !== isAtTop.value) {
    isAtTop.value = atTop;
  }
};

// Check if window is at the top
const isWindowAtTop = () => {
  return Math.max(window.scrollY, document.documentElement.scrollTop, document.body.scrollTop) <= 0;
};

// Touch event handlers
const handleTouchStart = (e: TouchEvent) => {
  wasAtTop.value = false;
  if (!props.enabled || !containerRef.value) return;

  // First check if window is scrolled, if so, don't proceed
  if (!isWindowAtTop()) return;

  // Check if we're at the top
  isAtTop.value = checkIfAtTop();

  // Set wasAtTop based on current scroll position
  wasAtTop.value = isAtTop.value;

  if (isAtTop.value) {
    touchStartY = e.touches[0].clientY;
    lastTouchY = touchStartY;
    pullStartY.value = touchStartY;
    touchInitialDirection.value = null; // Reset direction detection

    // Cancel any ongoing animation
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  }
};

const handleTouchMove = (e: TouchEvent) => {
  if (!props.enabled || isRefreshing.value || !containerRef.value || !wasAtTop.value) return;

  // Get current Y position
  const currentY = e.touches[0].clientY;

  // Determine touch direction if not already set
  if (touchInitialDirection.value === null) {
    if (currentY > lastTouchY) {
      touchInitialDirection.value = 'down';
    } else if (currentY < lastTouchY) {
      touchInitialDirection.value = 'up';
    }
  }

  // Update last touch position
  lastTouchY = currentY;

  // Only continue if we're moving downward after being at the top
  if (touchInitialDirection.value !== 'down') return;

  const pullDistance = currentY - pullStartY.value;

  // Only consider it a pull if distance exceeds the minimum threshold
  if (pullDistance > (props.options.minSwipeDistance || 15)) {
    if (!isPulling.value) {
      isPulling.value = true;
    }

    // Apply resistance to the pull (using square root for smoother feel)
    pullContentOffset.value = Math.sqrt(pullDistance - (props.options.minSwipeDistance || 15)) * 3.5;
    // Calculate progress percentage
    refreshProgress.value = Math.min(100, (pullContentOffset.value / (props.options.pullThreshold || 70)) * 100);

    // Prevent default scrolling behavior when pulling down at the top
    e.preventDefault();
    e.stopPropagation();
  }
};

const handleTouchEnd = () => {
  wasAtTop.value = false;
  if (!props.enabled || !isPulling.value) return;

  // Reset direction detection
  touchInitialDirection.value = null;

  // If pulled far enough, trigger refresh
  if (refreshProgress.value >= 100 && !isRefreshing.value) {
    doRefresh();
  } else {
    // Reset pull state with smooth animation
    animateReset();
  }
};

// Animation functions
const animateReset = () => {
  // Store starting values
  const startOffset = pullContentOffset.value;
  const startTime = performance.now();
  const duration = 250; // 250ms for the animation

  const animate = (currentTime: number) => {
    const elapsedTime = currentTime - startTime;
    const progress = Math.min(elapsedTime / duration, 1);

    // Easing function - ease out quad
    const easeOut = 1 - Math.pow(1 - progress, 2);

    // Calculate current values
    pullContentOffset.value = startOffset * (1 - easeOut);
    refreshProgress.value = Math.min(100, (pullContentOffset.value / (props.options.pullThreshold || 70)) * 100);

    // Continue animation if not complete
    if (progress < 1) {
      animationFrameId = requestAnimationFrame(animate);
    } else {
      // Reset completely when done
      resetPullState();
      animationFrameId = null;
    }
  };

  // Start animation
  animationFrameId = requestAnimationFrame(animate);
};

const doRefresh = async () => {
  isRefreshing.value = true;

  // Snap to proper position showing the indicator
  const startOffset = pullContentOffset.value;
  const targetOffset = props.options.pullThreshold || 70;
  const startTime = performance.now();
  const snapDuration = 150; // 150ms quick snap

  const snapToRefreshingPosition = (currentTime: number) => {
    const elapsedTime = currentTime - startTime;
    const progress = Math.min(elapsedTime / snapDuration, 1);

    // Simple ease-out for snap
    const easeOut = 1 - Math.pow(1 - progress, 2);

    // Animate to exact position
    if (startOffset > targetOffset) {
      // If pulled further than target, snap back
      pullContentOffset.value = startOffset - (startOffset - targetOffset) * easeOut;
    } else {
      // If not pulled far enough, snap forward
      pullContentOffset.value = startOffset + (targetOffset - startOffset) * easeOut;
    }

    // Continue animation if not complete
    if (progress < 1) {
      animationFrameId = requestAnimationFrame(snapToRefreshingPosition);
    } else {
      // Start the actual data refresh when positioned correctly
      startDataRefresh();
    }
  };

  // Start the snap animation
  animationFrameId = requestAnimationFrame(snapToRefreshingPosition);

  const startDataRefresh = async () => {
    try {
      // Call the onRefresh callback from props
      await props.onRefresh();

      // After data is loaded, animate away with a short delay
      setTimeout(() => {
        const resetStartTime = performance.now();
        const resetDuration = 300; // Slightly longer reset duration

        const resetAnimation = (currentTime: number) => {
          const elapsedTime = currentTime - resetStartTime;
          const progress = Math.min(elapsedTime / resetDuration, 1);

          // Easing function - ease out
          const easeOut = 1 - Math.pow(1 - progress, 3); // Using cubic for smoother fade out

          // Calculate current value - animate from current position to 0
          pullContentOffset.value = targetOffset * (1 - easeOut);

          // Continue animation if not complete
          if (progress < 1) {
            animationFrameId = requestAnimationFrame(resetAnimation);
          } else {
            // Reset all values when done
            resetPullState();
            animationFrameId = null;
          }
        };

        // Start reset animation
        animationFrameId = requestAnimationFrame(resetAnimation);
      }, 800); // Show refreshing state for 800ms
    } catch (error) {
      console.error('Failed to refresh content:', error);
      resetPullState();
    }
  };
};

const resetPullState = () => {
  isPulling.value = false;
  isRefreshing.value = false;
  refreshProgress.value = 0;
  pullContentOffset.value = 0;
  touchInitialDirection.value = null;
};

// Setup and cleanup
onMounted(() => {
  if (containerRef.value) {
    containerRef.value.addEventListener('scroll', handleContainerScroll);
    // Initialize the isAtTop flag
    isAtTop.value = checkIfAtTop();
  }
});

onUnmounted(() => {
  if (containerRef.value) {
    containerRef.value.removeEventListener('scroll', handleContainerScroll);
  }

  // Clean up any ongoing animation
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
});
</script>

<template>
  <div
    ref="containerRef"
    class="ptr-container"
    @touchstart="handleTouchStart"
    @touchmove="handleTouchMove"
    @touchend="handleTouchEnd"
    @touchcancel="resetPullState"
  >
    <!-- Pull container for unified movement -->
    <div class="ptr-pull-container" :style="{ transform: `translateY(${pullContentOffset}px)` }">
      <!-- Pull to refresh indicator -->
      <div
        v-if="enabled"
        class="ptr-indicator"
        :class="{ 'ptr-active': isPulling, 'ptr-refreshing': isRefreshing }"
        :style="{
          height: `${props.options.pullThreshold || 70}px`,
          top: `-${props.options.pullThreshold || 70}px`,
        }"
      >
        <div class="ptr-spinner-container">
          <div
            class="ptr-spinner"
            :style="{ transform: isRefreshing ? 'rotate(0deg)' : `rotate(${refreshProgress * 3.6}deg)` }"
          >
            <Icon
              icon="mdi:refresh"
              class="h-6 w-6 text-primary transition-all duration-300"
              :class="{ 'animate-spin': isRefreshing }"
            />
          </div>
          <span v-if="isRefreshing" class="ptr-text">{{ options.refreshText }}</span>
          <span v-else-if="refreshProgress >= 100" class="ptr-text">{{ options.releaseText }}</span>
          <span v-else-if="refreshProgress > 0" class="ptr-text">{{ options.pullingText }}</span>
          <span v-else-if="isAtTop" class="ptr-text ptr-hint">{{ options.pullingText }}</span>
        </div>
      </div>

      <!-- Content slot -->
      <div class="ptr-content">
        <slot></slot>
      </div>
    </div>
  </div>
</template>

<style>
.ptr-container {
  width: 100%;
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
  position: relative;
  touch-action: pan-x pan-y;
}

.ptr-pull-container {
  position: relative;
  width: 100%;
  overflow: visible;
  transform: translateZ(0);
  will-change: transform;
  transition: transform 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
}

.ptr-indicator {
  position: absolute;
  left: 0;
  width: 100%;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: hsl(var(--background) / 0.95);
  z-index: 10;
  padding-bottom: 16px;
  box-sizing: border-box;
  will-change: transform;
  transition: transform 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
}

.ptr-spinner-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  pointer-events: none;
}

.ptr-spinner {
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.2s ease;
}

.ptr-text {
  font-size: 12px;
  color: hsl(var(--primary));
  margin-top: 4px;
  font-weight: 500;
}

.ptr-text.ptr-hint {
  opacity: 0.7;
  font-size: 11px;
  animation: ptr-fade-in-out 2s ease-in-out infinite;
}

.ptr-content {
  position: relative;
}

@keyframes ptr-fade-in-out {
  0% {
    opacity: 0.5;
  }
  50% {
    opacity: 0.8;
  }
  100% {
    opacity: 0.5;
  }
}

/* Fix for Safari flickering issue */
@supports (-webkit-touch-callout: none) {
  .ptr-pull-container {
    -webkit-transform-style: preserve-3d;
  }

  .ptr-indicator {
    -webkit-transform: translateZ(0);
  }
}
</style>
