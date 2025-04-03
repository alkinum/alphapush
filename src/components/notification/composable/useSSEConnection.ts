import { ref, onUnmounted } from 'vue';
import type { Ref } from 'vue';
import { getCombinedFingerprint } from '@/utils/fingerprint';
import { StreamErrorCode } from '@/pages/api/stream';
import type { Notification } from '@/types/notification';

// Define types for SSE events
interface MessageEvent extends Event {
  data: string;
}

// Define error response type
interface ErrorResponse {
  error: string;
  code: StreamErrorCode;
}

// Define user fingerprints interface
interface UserFingerprints {
  [userEmail: string]: string;
}

export interface SSEHandlers {
  onNewNotification?: (notification: Notification) => void;
  onUpdateNotification?: (notification: Notification) => void;
  onDeleteNotification?: (id: string) => void;
}

/**
 * Composable for managing Server-Sent Events connection
 */
export function useSSEConnection(userEmail: Ref<string | null | undefined>, handlers: SSEHandlers = {}) {
  const eventSource = ref<EventSource | null>(null);
  const isConnected = ref(false);
  const connectionError = ref<string | null>(null);

  /**
   * Connect to SSE endpoint and set up event listeners
   */
  const connect = async () => {
    if (!userEmail.value) {
      console.log('SSE connection not initiated: User not logged in');
      return;
    }

    try {
      // Get fingerprints from storage
      const userFingerprints = localStorage.getItem('userFingerprints');
      let fingerprints: UserFingerprints = {};

      try {
        fingerprints = userFingerprints ? JSON.parse(userFingerprints) : {};
      } catch (error) {
        console.error('Error parsing stored fingerprints:', error);
      }

      const email = userEmail.value;

      // Get fingerprint for current user or generate a new one
      const deviceFingerprint =
        (fingerprints && fingerprints[email]) || (await getCombinedFingerprint(email));

      const sseUrl = `/api/stream?fingerprint=${encodeURIComponent(deviceFingerprint)}`;

      console.log('Attempting to connect SSE:', sseUrl);

      // Close existing connection if any
      if (eventSource.value) {
        eventSource.value.close();
      }

      eventSource.value = new EventSource(sseUrl);

      // Set up event listeners
      eventSource.value.onopen = () => {
        console.log('SSE connection established');
        isConnected.value = true;
        connectionError.value = null;
      };

      // Listen for different notification events
      eventSource.value.addEventListener('newNotification', (event) => {
        console.log('Received new notification event');
        try {
          const messageEvent = event as unknown as MessageEvent;
          const notification = JSON.parse(messageEvent.data);

          if (handlers.onNewNotification) {
            handlers.onNewNotification(notification);
          }
        } catch (error) {
          console.error('Error parsing SSE data:', error);
        }
      });

      eventSource.value.addEventListener('updateNotification', (event) => {
        console.log('Received update notification event');
        try {
          const messageEvent = event as unknown as MessageEvent;
          const notification = JSON.parse(messageEvent.data);

          if (handlers.onUpdateNotification) {
            handlers.onUpdateNotification(notification);
          }
        } catch (error) {
          console.error('Error handling update notification event:', error);
        }
      });

      eventSource.value.addEventListener('deleteNotification', (event) => {
        console.log('Received delete notification event');
        try {
          const messageEvent = event as unknown as MessageEvent;
          const data = JSON.parse(messageEvent.data);

          if (data.id) {
            document.dispatchEvent(new CustomEvent('notificationDeleted', {
              detail: {
                notificationId: data.id
              }
            }));

            if (handlers.onDeleteNotification) {
              handlers.onDeleteNotification(data.id);
            }
          }
        } catch (error) {
          console.error('Error handling delete notification event:', error);
        }
      });

      eventSource.value.addEventListener('error', (event) => {
        console.error('SSE error:', event);
        isConnected.value = false;

        // Check if the error is due to an HTTP error response
        if (event.target && (event.target as EventSource).readyState === EventSource.CLOSED) {
          // Try to get the error details from the response
          fetch(sseUrl, { method: 'GET' })
            .then(async (response) => {
              if (!response.ok) {
                const errorData = (await response.json()) as ErrorResponse;
                connectionError.value = errorData.error;

                // Check if it's an invalid fingerprint error
                if (errorData.code === StreamErrorCode.INVALID_FINGERPRINT) {
                  console.log('Invalid fingerprint detected in SSE connection');

                  // Dispatch an event to handle the error at the application level
                  window.dispatchEvent(
                    new CustomEvent('SSEConnectionError', {
                      detail: {
                        error: errorData.error,
                        code: errorData.code,
                      },
                    }),
                  );

                  // Don't try to reconnect immediately, let the event handler handle it
                  return;
                }
              }

              // For other errors, try to reconnect
              if (eventSource.value) {
                eventSource.value.close();
              }
              setTimeout(() => {
                console.log('Attempting to reconnect SSE...');
                connect();
              }, 5000);
            })
            .catch((error) => {
              console.error('Error checking SSE connection status:', error);
              connectionError.value = 'Connection error';

              // For network errors, try to reconnect
              if (eventSource.value) {
                eventSource.value.close();
              }
              setTimeout(() => {
                console.log('Attempting to reconnect SSE after fetch error...');
                connect();
              }, 5000);
            });
        } else {
          // For other types of errors, try to reconnect
          if (eventSource.value) {
            eventSource.value.close();
          }
          setTimeout(() => {
            console.log('Attempting to reconnect SSE...');
            connect();
          }, 5000);
        }
      });
    } catch (error) {
      console.error('Error setting up SSE:', error);
      connectionError.value = 'Failed to set up connection';
      isConnected.value = false;
    }
  };

  /**
   * Disconnect from SSE endpoint
   */
  const disconnect = () => {
    if (eventSource.value) {
      console.log('Closing SSE connection');
      eventSource.value.close();
      eventSource.value = null;
      isConnected.value = false;
    }
  };

  // Clean up on component unmount
  onUnmounted(() => {
    disconnect();
  });

  return {
    connect,
    disconnect,
    isConnected,
    connectionError
  };
}