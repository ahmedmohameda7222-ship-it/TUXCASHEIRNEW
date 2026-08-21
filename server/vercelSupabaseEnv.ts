function firstConfigured(names: readonly string[]): string | null {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return null;
}

/**
 * Normalize common Vercel/Supabase environment-variable names into the private
 * TUX server names consumed by the gateway. This module is used only by Vercel
 * Functions; the browser bundle never imports or reads these variables.
 */
export function normalizeVercelSupabaseEnv(): void {
  const url = firstConfigured([
    'TUX_SUPABASE_URL',
    'SUPABASE_URL',
    'VITE_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_URL',
  ]);
  if (url && !process.env['TUX_SUPABASE_URL']?.trim()) {
    process.env['TUX_SUPABASE_URL'] = url;
  }

  const publishableKey = firstConfigured([
    'TUX_SUPABASE_PUBLISHABLE_KEY',
    'SUPABASE_PUBLISHABLE_KEY',
    'SUPABASE_ANON_KEY',
    'SUPABASE_KEY',
    'VITE_SUPABASE_PUBLISHABLE_KEY',
    'VITE_SUPABASE_ANON_KEY',
    'VITE_SUPABASE_KEY',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  ]);
  if (publishableKey && !process.env['TUX_SUPABASE_PUBLISHABLE_KEY']?.trim()) {
    process.env['TUX_SUPABASE_PUBLISHABLE_KEY'] = publishableKey;
  }
}
