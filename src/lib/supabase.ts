import { createClient } from '@supabase/supabase-js';

/**
 * 与 kaoyan-vocab5 共用同一个 Supabase 项目（账号互通）。
 * anon key 为公开 publishable key，安全边界由数据库 RLS 保证。
 */
export const SUPABASE_URL = 'https://qvemohfojzawpnleyjsb.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_VFalDAdNoIgd19oxlZ8wlw_AM-rv7Uq';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { storageKey: 'ds-notes-auth' },
});
