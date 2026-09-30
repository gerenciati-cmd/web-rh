import { describe, expect, it } from 'vitest';

import { RecordingEmailSender } from '@/shared/testing/fakes';

import {
  SEND_PASSWORD_RESET_EMAIL,
  SendPasswordResetEmail,
  type SendPasswordResetEmailData,
} from './send-password-reset-email.job';

const LINK = 'https://rrhh.example.test/restablecer?token=abc123';
// 2026-01-22 12:00 UTC = 07:00 en Cancún (UTC-5, sin horario de verano).
const EXPIRES_AT = '2026-01-22T12:00:00.000Z';
const base: SendPasswordResetEmailData = {
  to: 'ana@aps.cl',
  link: LINK,
  expiresAt: EXPIRES_AT,
  forcedByStaff: false,
};

describe('SendPasswordResetEmail', () => {
  it('se registra con el nombre de job estable', () => {
    expect(new SendPasswordResetEmail({ emailSender: new RecordingEmailSender() }).name).toBe(
      'identity.send-password-reset-email',
    );
    expect(SEND_PASSWORD_RESET_EMAIL).toBe('identity.send-password-reset-email');
  });

  it('envía un correo en español al destinatario, con el enlace y el vencimiento en hora de Cancún', async () => {
    const sender = new RecordingEmailSender();

    await new SendPasswordResetEmail({ emailSender: sender }).handle(base);

    expect(sender.sent).toHaveLength(1);
    const [email] = sender.sent;
    expect(email?.to).toBe('ana@aps.cl');
    expect(email?.subject).toBe('Restablece tu contraseña de RRHH APS');
    expect(email?.text).toContain(LINK);
    expect(email?.text).toContain('22 de enero de 2026');
    expect(email?.text).toMatch(/7:00/);
    expect(email?.text).toContain('solo se puede usar una vez');
    expect(email?.text).toContain(
      'Si no lo solicitaste, ignora este correo: tu contraseña no cambia.',
    );
  });

  it('si lo pidió el propio usuario no menciona a un administrador', async () => {
    const sender = new RecordingEmailSender();

    await new SendPasswordResetEmail({ emailSender: sender }).handle(base);

    expect(sender.sent[0]?.text).not.toContain('administrador');
  });

  it('si lo forzó el personal lo dice antes del enlace', async () => {
    const sender = new RecordingEmailSender();

    await new SendPasswordResetEmail({ emailSender: sender }).handle({
      ...base,
      forcedByStaff: true,
    });

    const text = sender.sent[0]?.text ?? '';
    expect(text).toContain('Un administrador solicitó restablecer tu contraseña.');
    expect(text.indexOf('Un administrador')).toBeLessThan(text.indexOf(LINK));
  });

  it('propaga el fallo del envío para que la cola reintente', async () => {
    const job = new SendPasswordResetEmail({
      emailSender: { send: () => Promise.reject(new Error('SMTP caído')) },
    });

    await expect(job.handle(base)).rejects.toThrow('SMTP caído');
  });
});
