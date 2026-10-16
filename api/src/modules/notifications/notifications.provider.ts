import type { NotificationProvider } from './notifications.types';

export class ConsoleNotificationProvider implements NotificationProvider {
  async sendSms(to: string, text: string): Promise<void> {
    // eslint-disable-next-line no-console
    console.log('[sms]', { to, text });
  }

  async sendWhatsapp(to: string, text: string): Promise<void> {
    // eslint-disable-next-line no-console
    console.log('[whatsapp]', { to, text });
  }

  async sendPush(toUserId: string, text: string, payload?: Record<string, unknown>): Promise<void> {
    // eslint-disable-next-line no-console
    console.log('[push]', { toUserId, text, payload });
  }
}
