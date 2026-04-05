export interface SettingsPayload {
  tg_token?: string;
  tg_admin_id?: string;
  llm_provider?: string;
  api_key?: string;
  proxy_url?: string;
}

export const updateSettings = async (settings: SettingsPayload) => {
  const response = await fetch('/api/settings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(settings),
  });
  
  if (!response.ok) {
    throw new Error('Failed to update settings');
  }
  
  return response.json();
};

export const getBotStatus = async () => {
  const response = await fetch('/api/bot/status');
  
  if (!response.ok) {
    throw new Error('Failed to get bot status');
  }
  
  return response.json();
};
