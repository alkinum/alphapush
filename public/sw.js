const TOKEN_TTL = 5 * 60 * 1000; // 5 minutes in milliseconds
const TOKEN_EXPIRY_THRESHOLD = 30 * 1000; // 30 seconds before expiry

self.addEventListener('push', function (event) {
  const data = event.data.json();
  let options = {
    body: data.body,
    icon: data.iconUrl || '/icon.png',
    vibrate: [50, 25, 120],
    data: {
      id: data.id,
      category: data.category,
      group: data.group,
      type: data.type,
      approvalId: data.approvalId,
      createdAt: data.createdAt,
      tempAccessToken: data.tempAccessToken,
    },
  };

  if (data.type === 'approval-process') {
    options.actions = [
      { action: 'detail', title: 'View Details' },
      { action: 'reject', title: 'Reject' },
      { action: 'approve', title: 'Approve' },
    ];
  } else {
    options.actions = [{ action: 'detail', title: 'View Details' }];
  }

  self.registration.showNotification(data.title, options);
});

self.addEventListener('notificationclick', function (event) {
  const notificationData = event.notification.data;

  const url = new URL('/', self.location.origin);
  const currentTime = Date.now();
  const timeSinceCreation = currentTime - notificationData.createdAt;

  if (notificationData.type === 'approval-process') {
    if (timeSinceCreation < TOKEN_TTL - TOKEN_EXPIRY_THRESHOLD) {
      // Token is still valid, directly update the approval state
      if (event.action === 'approve' || event.action === 'reject') {
        event.waitUntil(
          updateApprovalState(notificationData.approvalId, event.action, notificationData.tempAccessToken)
            .then(() => {
              event.notification.close();
            })
            .catch((error) => {
              console.error('Failed to update approval state:', error);
              // If update fails, fall back to opening the details page
              url.searchParams.set('approvalId', notificationData.approvalId);
              clients.openWindow(url.toString());
            }),
        );
        return;
      }
    }

    // Token is expired or nearly expired, or action is 'detail'
    url.searchParams.set('approvalId', notificationData.approvalId);
  }

  if (event.action === 'detail' || !event.action) {
    url.searchParams.set('notificationId', notificationData.id);
    url.searchParams.set('category', notificationData.category);
    url.searchParams.set('group', notificationData.group);
  }

  event.notification.close();
  event.waitUntil(clients.openWindow(url.toString()));
});

async function updateApprovalState(approvalId, action, token) {
  const state = action === 'approve' ? 'approved' : 'rejected';
  const response = await fetch('/api/approval', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ approvalId, state }),
  });

  if (!response.ok) {
    throw new Error('Failed to update approval state');
  }

  return response.json();
}
