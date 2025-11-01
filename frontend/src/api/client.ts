
import { client } from './generated/client.gen';

const API_BASE = import.meta.env.VITE_API_URL || '';
const TOKEN_KEY = 'stemset_token';

client.setConfig({
  baseUrl: API_BASE,
  headers: () => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) {
      return {
        Authorization: `Bearer ${token}`,
      };
    }
    return {};
  },
});
