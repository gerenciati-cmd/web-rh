import type { EmailSender } from '@/shared/application/email';
import type { JobHandler } from '@/shared/application/jobs';

export const SEND_PASSWORD_RESET_EMAIL = 'identity.send-password-reset-email';

/** Payload del job. `link` lleva el token en claro: el job se encola como `sensitive`. */
export interface SendPasswordResetEmailData {
  to: string;
  link: string;
  /** ISO 8601. */
  expiresAt: string;
  /** `true` si lo forzó el personal de RRHH o el holding. */
  forcedByStaff: boolean;
}

interface Deps {
  emailSender: EmailSender;
}

/** Nunca registra el enlace ni el destinatario: el enlace es una credencial de un solo uso. */
export class SendPasswordResetEmail implements JobHandler<SendPasswordResetEmailData> {
  readonly name = SEND_PASSWORD_RESET_EMAIL;

  constructor(private readonly deps: Deps) {}

  async handle(data: SendPasswordResetEmailData): Promise<void> {
    const expires = new Intl.DateTimeFormat('es-MX', {
      dateStyle: 'long',
      timeStyle: 'short',
      timeZone: 'America/Cancun',
    }).format(new Date(data.expiresAt));

    await this.deps.emailSender.send({
      to: data.to,
      subject: 'Restablece tu contraseña de RRHH APS',
      text: [
        'Hola,',
        '',
        ...(data.forcedByStaff ? ['Un administrador solicitó restablecer tu contraseña.'] : []),
        'Para crear una contraseña nueva, abre este enlace:',
        '',
        data.link,
        '',
        `El enlace vence el ${expires} y solo se puede usar una vez.`,
        'Si no lo solicitaste, ignora este correo: tu contraseña no cambia.',
      ].join('\n'),
    });
  }
}
