/** Correo saliente en texto plano (sin plantillas HTML todavía). */
export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
}

/**
 * Envío de correo. Los casos de uso NO lo llaman directo: encolan un job (`JobQueue`) y el
 * handler del worker usa este puerto, para que un SMTP caído no rompa la petición HTTP.
 */
export interface EmailSender {
  send(email: OutgoingEmail): Promise<void>;
}
