import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

export async function api(endpoint, options = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;

  return fetch(`${import.meta.env.VITE_API_URL}/api${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
  });
}
