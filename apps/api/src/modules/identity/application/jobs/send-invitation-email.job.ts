import type { EmailSender } from '@/shared/application/email';
import type { JobHandler } from '@/shared/application/jobs';

export const SEND_INVITATION_EMAIL = 'identity.send-invitation-email';

/** Payload del job. `link` lleva el token en claro: el job se encola como `sensitive`. */
export interface SendInvitationEmailData {
  to: string;
  /** `null` = invitación a alguien que no es colaborador. */
  fullName: string | null;
  link: string;
  /** ISO 8601. */
  expiresAt: string;
}

interface Deps {
  emailSender: EmailSender;
}

/** Nunca registra el enlace ni el destinatario: el enlace es una credencial de un solo uso. */
export class SendInvitationEmail implements JobHandler<SendInvitationEmailData> {
  readonly name = SEND_INVITATION_EMAIL;

  constructor(private readonly deps: Deps) {}

  async handle(data: SendInvitationEmailData): Promise<void> {
    const expires = new Intl.DateTimeFormat('es-MX', {
      dateStyle: 'long',
      timeZone: 'America/Cancun',
    }).format(new Date(data.expiresAt));
    const greeting = data.fullName ? `Hola ${data.fullName},` : 'Hola,';

    await this.deps.emailSender.send({
      to: data.to,
      subject: 'Activa tu acceso a RRHH APS',
      text: [
        greeting,
        '',
        'Te invitaron a activar tu acceso a la plataforma de RRHH de APS Holding.',
        'Para crear tu contraseña y entrar, abre este enlace:',
        '',
        data.link,
        '',
        `El enlace vence el ${expires} y solo se puede usar una vez.`,
        'Si no esperabas este correo, puedes ignorarlo.',
      ].join('\n'),
    });
  }
}
