self.addEventListener('push', function (event) {
  const data = event.data.json();
  const options = {
    body: data.body,
    icon: '/icon.png',
    vibrate: [100, 50, 100],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: '2',
    },
    actions: [
      { action: 'explore', title: 'View Details' },
      { action: 'close', title: 'Close' },
    ],
  };

  // Immediately show the notification, without using event.waitUntil
  self.registration.showNotification(data.title, options);
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();

  if (event.action === 'explore') {
    // Handle the "View Details" action
    clients.openWindow('/details');
  } else if (event.action === 'close') {
    // Handle the "Close" action
  } else {
    // Handle the case where the notification itself is clicked
    clients.openWindow('/');
  }
});
