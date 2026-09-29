import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

/**
 * Verifica si se puede enviar una notificación para el par (service_id, event_type).
 *
 * Usa una función PL/pgSQL atómica en Postgres que:
 *   - Inserta el primer registro si no existe → retorna true (enviar)
 *   - Si existe y el cooldown expiró → actualiza last_sent_at → retorna true (enviar)
 *   - Si existe y el cooldown está activo → incrementa suppressed_count → retorna false (suprimir)
 *
 * @param supabase     Cliente con service role (bypasea RLS)
 * @param serviceId    UUID del servicio
 * @param eventType    Tipo de evento: 'backup_failed' | 'backup_warning' | 'backup_success' | 'kopia_failed' | etc.
 * @param cooldownMin  Minutos de cooldown (default 15)
 * @returns            true si se debe enviar, false si se debe suprimir
 */
export async function canSendNotification(
  supabase: SupabaseClient,
  serviceId: string,
  eventType: string,
  cooldownMin = 15,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("try_acquire_notification_lock", {
    p_service_id:   serviceId,
    p_event_type:   eventType,
    p_cooldown_min: cooldownMin,
  });

  if (error) {
    // En caso de error (ej. red), dejar pasar para no bloquear la notificación
    console.error("[notificationLock] error al verificar lock:", error.message);
    return true;
  }

  if (!data) {
    console.log(`[notificationLock] suprimido: ${eventType} para service ${serviceId} (cooldown ${cooldownMin}min activo)`);
  }

  return data === true;
}
