export interface SettingsPayload {
  tg_token?: string;
  tg_admin_id?: string;
  llm_provider?: string;
  api_key?: string;
  proxy_url?: string;
  base_url?: string;
  model_name?: string;
  proxy_config?: any;
}

export const updateSettings = async (settings: SettingsPayload) => {
  const response = await fetch('/api/settings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${localStorage.getItem('access_token')}`
    },
    body: JSON.stringify(settings),
  });
  
  if (!response.ok) {
    throw new Error('Failed to update settings');
  }
  
  return response.json();
};

export const getSettings = async () => {
  const response = await fetch('/api/settings', {
    headers: {
      'Authorization': `Bearer ${localStorage.getItem('access_token')}`
    }
  });
  
  if (!response.ok) {
    throw new Error('Failed to get settings');
  }
  
  return response.json();
};

export const getBotStatus = async () => {
  const response = await fetch('/api/bot/status', {
    headers: {
      'Authorization': `Bearer ${localStorage.getItem('access_token')}`
    }
  });
  
  if (!response.ok) {
    throw new Error('Failed to get bot status');
  }
  
  return response.json();
};
