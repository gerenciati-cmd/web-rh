import { describe, expect, it } from 'vitest';

import { RecordingEmailSender } from '@/shared/testing/fakes';

import { SEND_INVITATION_EMAIL, SendInvitationEmail } from './send-invitation-email.job';

const LINK = 'https://rrhh.example.test/activar?token=abc123';
const EXPIRES_AT = '2026-01-22T12:00:00.000Z';

describe('SendInvitationEmail', () => {
  it('se registra con el nombre de job estable', () => {
    expect(new SendInvitationEmail({ emailSender: new RecordingEmailSender() }).name).toBe(
      'identity.send-invitation-email',
    );
    expect(SEND_INVITATION_EMAIL).toBe('identity.send-invitation-email');
  });

  it('envía un correo en español al destinatario, con el nombre, el enlace y la fecha de vencimiento', async () => {
    const sender = new RecordingEmailSender();
    const job = new SendInvitationEmail({ emailSender: sender });

    await job.handle({
      to: 'ana@aps.cl',
      fullName: 'Ana Rojas',
      link: LINK,
      expiresAt: EXPIRES_AT,
    });

    expect(sender.sent).toHaveLength(1);
    const [email] = sender.sent;
    expect(email?.to).toBe('ana@aps.cl');
    expect(email?.subject).toBe('Activa tu acceso a RRHH APS');
    expect(email?.text).toContain('Hola Ana Rojas,');
    expect(email?.text).toContain(LINK);
    expect(email?.text).toContain('22 de enero de 2026');
    expect(email?.text).toContain('solo se puede usar una vez');
  });

  it('sin nombre (invitación externa) usa un saludo genérico', async () => {
    const sender = new RecordingEmailSender();
    const job = new SendInvitationEmail({ emailSender: sender });

    await job.handle({ to: 'x@externo.com', fullName: null, link: LINK, expiresAt: EXPIRES_AT });

    expect(sender.sent[0]?.text.startsWith('Hola,\n')).toBe(true);
    expect(sender.sent[0]?.text).not.toContain('null');
  });

  it('propaga el fallo del envío para que la cola reintente', async () => {
    const job = new SendInvitationEmail({
      emailSender: { send: () => Promise.reject(new Error('SMTP caído')) },
    });

    await expect(
      job.handle({ to: 'ana@aps.cl', fullName: null, link: LINK, expiresAt: EXPIRES_AT }),
    ).rejects.toThrow('SMTP caído');
  });
});
