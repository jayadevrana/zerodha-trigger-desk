export async function fetchPublicIpv4() {
  const endpoints = [
    "https://api.ipify.org?format=json",
    "https://ifconfig.me/all.json",
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        continue;
      }

      const payload = await response.json();
      const ip = payload.ip_addr || payload.ip;
      if (typeof ip === "string" && ip.trim()) {
        return ip.trim();
      }
    } catch {
      // Try the next endpoint.
    }
  }

  return null;
}
