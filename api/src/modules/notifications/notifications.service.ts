import { pool } from '../../db/pool';
import { ConsoleNotificationProvider } from './notifications.provider';
import type { NotificationProvider } from './notifications.types';
import { NOTIFICATION_TEMPLATES, type NotificationTemplateKey } from './notifications.templates';

let provider: NotificationProvider = new ConsoleNotificationProvider();

export function setNotificationProvider(p: NotificationProvider): void {
  provider = p;
}

function render(template: NotificationTemplateKey, params: Record<string, string | number | undefined> = {}): string {
  let text = NOTIFICATION_TEMPLATES[template] as string;
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    text = text.replace(new RegExp(`{${key}}`, 'g'), String(value));
    text = text.replace(new RegExp(`#${key}`, 'g'), String(value));
  }
  return text;
}

export interface NotifyParams {
  userId: string;
  template: NotificationTemplateKey;
  params?: Record<string, string | number | undefined>;
  payload?: Record<string, unknown>;
  channel?: 'push' | 'sms' | 'whatsapp';
}

export async function notify(params: NotifyParams): Promise<void> {
  const text = render(params.template, params.params);
  const channel = params.channel ?? 'push';
  try {
    if (channel === 'sms') {
      const user = await pool.query<{ phone: string | null }>('SELECT phone FROM users WHERE id = $1', [params.userId]);
      if (user.rows[0]?.phone) {
        await provider.sendSms(user.rows[0].phone, text);
      }
    } else if (channel === 'whatsapp') {
      const user = await pool.query<{ phone: string | null }>('SELECT phone FROM users WHERE id = $1', [params.userId]);
      if (user.rows[0]?.phone) {
        await provider.sendWhatsapp(user.rows[0].phone, text);
      }
    } else {
      await provider.sendPush(params.userId, text, params.payload);
    }
    await pool.query(
      'INSERT INTO notifications (user_id, channel, template, payload, sent_at) VALUES ($1, $2, $3, $4, now())',
      [params.userId, channel, params.template, JSON.stringify(params.payload ?? {})],
    );
  } catch (error) {
    await pool.query(
      'INSERT INTO notifications (user_id, channel, template, payload, sent_at, error) VALUES ($1, $2, $3, $4, now(), $5)',
      [params.userId, channel, params.template, JSON.stringify(params.payload ?? {}), error instanceof Error ? error.message : String(error)],
    );
  }
}
