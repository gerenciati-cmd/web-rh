import { createTransport, type Transporter } from 'nodemailer';

import type { EmailSender, OutgoingEmail } from '@/shared/application/email';

interface Deps {
  env: {
    SMTP_HOST: string;
    SMTP_PORT: number;
    SMTP_SECURE: boolean;
    SMTP_USER?: string | undefined;
    SMTP_PASSWORD?: string | undefined;
    MAIL_FROM: string;
  };
}

export class SmtpEmailSender implements EmailSender {
  #transport: Transporter | undefined;

  constructor(private readonly deps: Deps) {}

  /** Conexión perezosa: resolver el contenedor no abre sockets al servidor SMTP. */
  private get transport(): Transporter {
    const { env } = this.deps;
    this.#transport ??= createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD ?? '' } } : {}),
    });
    return this.#transport;
  }

  async send(email: OutgoingEmail): Promise<void> {
    await this.transport.sendMail({
      from: this.deps.env.MAIL_FROM,
      to: email.to,
      subject: email.subject,
      text: email.text,
    });
  }

  close(): void {
    this.#transport?.close();
  }
}
