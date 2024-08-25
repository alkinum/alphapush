self.addEventListener('push', function (event) {
  const data = event.data.json();
  const options = {
    body: data.body,
    icon: data.iconUrl || '/icon.png',
    vibrate: [50, 10, 60, 25, 90],
    data: {
      id: data.id,
      category: encodeURIComponent(data.category),
      group: encodeURIComponent(data.group),
    },
    actions: [{ action: 'detail', title: 'View Details' }],
  };

  // Immediately show the notification, without using event.waitUntil
  self.registration.showNotification(data.title, options);
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();

  const notificationData = event.notification.data;

  if (event.action === 'detail') {
    // Handle the "View Details" action
    clients.openWindow(
      `/?notificationId=${notificationData.id}&category=${notificationData.category}&group=${notificationData.group}`,
    );
  } else {
    // Handle the case where the notification itself is clicked
    clients.openWindow('/');
  }
});
