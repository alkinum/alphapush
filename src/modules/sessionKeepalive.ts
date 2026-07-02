const KEEPALIVE_ENDPOINT = '/api/session/keepalive';
const KEEPALIVE_STORAGE_KEY = 'sessionKeepaliveAt';
const KEEPALIVE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const KEEPALIVE_MIN_GAP_MS = 30 * 60 * 1000;

let isInitialized = false;
let inFlight: Promise<boolean> | null = null;

function isLoggedIn(): boolean {
  return document.body.dataset.userLoggedIn === 'true' && !!document.body.dataset.userEmail;
}

function getLastKeepaliveAt(): number {
  const value = localStorage.getItem(KEEPALIVE_STORAGE_KEY);
  const parsed = value ? Number(value) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function saveKeepaliveAt(timestamp: number): void {
  localStorage.setItem(KEEPALIVE_STORAGE_KEY, String(timestamp));
}

async function runKeepalive(force = false): Promise<boolean> {
  if (!isLoggedIn()) {
    localStorage.removeItem(KEEPALIVE_STORAGE_KEY);
    return false;
  }

  const now = Date.now();
  const lastKeepaliveAt = getLastKeepaliveAt();
  const minGap = force ? KEEPALIVE_MIN_GAP_MS : KEEPALIVE_INTERVAL_MS;

  if (lastKeepaliveAt && now - lastKeepaliveAt < minGap) {
    return true;
  }

  if (inFlight) {
    return inFlight;
  }

  inFlight = fetch(KEEPALIVE_ENDPOINT, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
    },
  })
    .then((response) => {
      if (!response.ok) {
        if (response.status === 401) {
          localStorage.removeItem(KEEPALIVE_STORAGE_KEY);
        }
        return false;
      }

      saveKeepaliveAt(Date.now());
      return true;
    })
    .catch((error) => {
      console.warn('Session keepalive failed:', error);
      return false;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

export function initializeSessionKeepalive(): void {
  if (isInitialized || typeof window === 'undefined') {
    return;
  }

  isInitialized = true;
  void runKeepalive(true);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void runKeepalive(true);
    }
  });

  window.addEventListener('pageshow', () => {
    void runKeepalive(true);
  });

  window.addEventListener('online', () => {
    void runKeepalive(true);
  });

  window.setInterval(() => {
    if (document.visibilityState === 'visible') {
      void runKeepalive();
    }
  }, KEEPALIVE_INTERVAL_MS);
}
