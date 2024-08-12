<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerFooter } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Icon } from '@iconify/vue';

const isOpen = ref(false);
const isIOS = ref(false);
const isMobile = ref(false);

onMounted(() => {
  isIOS.value = /iPad|iPhone|iPod/.test(navigator.userAgent);
  isMobile.value = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

  // Check if already installed as PWA and if it's a mobile device
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
  if (!isStandalone && isMobile.value) {
    isOpen.value = true;
  }
});

const closeDrawer = () => {
  isOpen.value = false;
};
</script>

<template>
  <Drawer v-model:open="isOpen" v-if="isMobile">
    <DrawerContent>
      <DrawerHeader>
        <DrawerTitle>Add App to Home Screen</DrawerTitle>
      </DrawerHeader>
      <div class="p-4 pb-0">
        <div v-if="isIOS">
          <!-- iOS guidance content -->
          <ol class="list-none space-y-4">
            <li class="flex items-center">
              <Icon icon="mdi:export-variant" class="mr-2 text-2xl text-blue-500" />
              <span>Tap the "Share" button at the bottom</span>
            </li>
            <li class="flex items-center">
              <Icon icon="mdi:plus-box-outline" class="mr-2 text-2xl text-blue-500" />
              <span>Select "Add to Home Screen" from the menu</span>
            </li>
            <li class="flex items-center">
              <Icon icon="mdi:check-circle-outline" class="mr-2 text-2xl text-green-500" />
              <span>Tap "Add" to confirm</span>
            </li>
          </ol>
        </div>
        <div v-else>
          <!-- Android guidance content -->
          <ol class="list-none space-y-4">
            <li class="flex items-center">
              <Icon icon="mdi:dots-vertical" class="mr-2 text-2xl text-blue-500" />
              <span>Tap the menu button (three dots) in the top right</span>
            </li>
            <li class="flex items-center">
              <Icon icon="mdi:cellphone-link" class="mr-2 text-2xl text-blue-500" />
              <span>Select "Add to Home screen" option</span>
            </li>
            <li class="flex items-center">
              <Icon icon="mdi:check-circle-outline" class="mr-2 text-2xl text-green-500" />
              <span>Tap "Add" to confirm</span>
            </li>
          </ol>
        </div>
      </div>
      <DrawerFooter>
        <Button @click="closeDrawer" class="w-full">
          <Icon icon="mdi:check" class="mr-2" />
          Got it
        </Button>
      </DrawerFooter>
    </DrawerContent>
  </Drawer>
</template>