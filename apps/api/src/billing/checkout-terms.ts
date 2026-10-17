/**
 * Consumer-law pieces of web checkout (Stripe) — kept apart from the billing mechanics.
 *
 *  1. Consent: before Checkout the customer ticks two separate boxes in the app — automatic renewal, and
 *     "start now" with the acknowledgement that withdrawing within the 14-day withdrawal period costs the
 *     service already provided (EU/EEA/UK consumers; CRD art. 8(8), 14(3)). The server refuses checkout
 *     without both and records them, with the terms version and language, in the Stripe metadata of the
 *     Checkout Session and of the subscription.
 *  2. The same notice next to Checkout's subscribe button.
 *  3. A confirmation email when a web subscription starts (durable medium, CRD art. 8(7)): plan, price,
 *     trial end, renewal, what the customer confirmed, the withdrawal deadline and how to withdraw, with
 *     the model withdrawal form.
 *
 * Policy (see the Terms of Use): no voluntary refunds beyond statutory rights; withdrawal and
 * conformity remedies required by law are never limited. Texts reviewed by a lawyer before launch.
 */
import { LANGUAGES, LEGAL_VERSION, planById, type CheckoutConsent, type Language, type PlanId } from '@study/shared';
import { HttpError } from '../lib/errors.js';

export const WITHDRAWAL_DAYS = 14;

const isLanguage = (v: unknown): v is Language => typeof v === 'string' && (LANGUAGES as readonly string[]).includes(v);
export const checkoutLanguage = (v: unknown): Language => (isLanguage(v) ? v : 'en');

/** Both boxes must be ticked (literally `true`), or nothing is created at Stripe. */
export function parseCheckoutConsent(body: Record<string, unknown>): CheckoutConsent {
  const c = (body.consent && typeof body.consent === 'object' ? body.consent : {}) as Record<string, unknown>;
  if (c.autoRenewal !== true || c.immediateStart !== true) {
    throw new HttpError(400, 'Please confirm the automatic renewal and the immediate start to continue.', 'checkout_consent_required');
  }
  return { autoRenewal: true, immediateStart: true };
}

/**
 * Metadata recorded on the Checkout Session and the subscription. `consentAt` is minute-precise on
 * purpose: repeated clicks within a minute reuse one Checkout Session (same idempotency key), and Stripe
 * requires identical parameters for that.
 */
export function consentMetadata(language: Language, now = Date.now()): Record<string, string> {
  return {
    exama_consent: 'auto_renewal,immediate_start',
    exama_consent_at: new Date(Math.floor(now / 60_000) * 60_000).toISOString(),
    exama_terms_version: LEGAL_VERSION,
    exama_language: language,
  };
}

/** Stripe Checkout locales for our languages (Stripe has no Arabic: the browser's language is used). */
export const stripeLocale = (language: Language) => (language === 'ar' ? 'auto' : language);

/** Shown next to Checkout's subscribe button (Stripe allows 1,200 characters). */
export const CHECKOUT_NOTICE: Record<Language, string> = {
  en: 'Your subscription starts now and renews automatically until you cancel (Account → Manage billing). EU, EEA and UK consumers can withdraw within 14 days; if paid service has already started, you pay only for the service provided until you withdraw. Terms of Use: see the link in the Exama app.',
  es: 'Tu suscripción empieza ahora y se renueva automáticamente hasta que la canceles (Cuenta → Gestionar facturación). Los consumidores de la UE, el EEE y el Reino Unido pueden desistir en un plazo de 14 días; si el servicio de pago ya ha empezado, solo pagas el servicio prestado hasta que desistas. Condiciones de uso: consulta el enlace en la app de Exama.',
  fr: 'Votre abonnement démarre maintenant et se renouvelle automatiquement jusqu’à sa résiliation (Compte → Gérer la facturation). Les consommateurs de l’UE, de l’EEE et du Royaume-Uni peuvent se rétracter dans un délai de 14 jours ; si le service payant a déjà commencé, vous ne payez que le service fourni jusqu’à votre rétractation. Conditions d’utilisation : voir le lien dans l’app Exama.',
  ar: 'يبدأ اشتراكك الآن ويتجدّد تلقائيًا حتى تلغيه (الحساب ← إدارة الفوترة). يحق للمستهلكين في الاتحاد الأوروبي والمنطقة الاقتصادية الأوروبية والمملكة المتحدة العدول خلال 14 يومًا؛ وإذا كانت الخدمة المدفوعة قد بدأت، فلا تدفع إلا مقابل الخدمة المقدَّمة حتى عدولك. شروط الاستخدام: راجع الرابط في تطبيق Exama.',
};

// ---------------------------------------------------------------- confirmation email

type EmailCopy = {
  subject: string;
  hello: (name: string) => string;
  started: (plan: string, period: string, date: string) => string;
  trial: (end: string, price: string) => string;
  paid: (price: string) => string;
  confirmed: string;
  withdrawal: (deadline: string) => string;
  how: string;
  formTitle: string;
  form: string[];
  manage: string;
  links: (terms: string, privacy: string) => string;
  monthly: string;
  yearly: string;
  perMonth: string;
  perYear: string;
};

const COPY: Record<Language, EmailCopy> = {
  en: {
    subject: 'Your Exama subscription: confirmation',
    hello: (n) => `Hi ${n},`,
    started: (plan, period, date) => `This confirms your Exama ${plan} subscription (${period}), started on ${date}.`,
    trial: (end, price) => `Your free trial ends on ${end}. Unless you cancel before then, you will be charged ${price} from that date, and the subscription then renews automatically until you cancel.`,
    paid: (price) => `You are charged ${price}; the subscription renews automatically until you cancel.`,
    confirmed: 'At checkout you agreed to the automatic renewal and asked us to start your subscription immediately.',
    withdrawal: (d) =>
      `If you are a consumer in the EU, the EEA or the UK, you can withdraw from this contract within 14 days, until ${d}, without giving any reason. If you withdraw after paid service has started, you pay for the service provided until you withdraw and we reimburse the rest within 14 days, using the same means of payment. Nothing is charged for the free trial.`,
    how: 'To withdraw, send us a clear statement, for example by email to the contact address in our Terms of Use. You may use this model form:',
    formTitle: 'Model withdrawal form',
    form: [
      'To Exama (contact details: see the Terms of Use):',
      'I hereby give notice that I withdraw from my contract for the provision of the following service: Exama subscription (plan: …)',
      'Ordered on: …',
      'Name of consumer: …',
      'Email address of the Exama account: …',
      'Address of consumer: …',
      'Date: …',
    ],
    manage: 'To stop the renewal, cancel any time in Exama under Account → Manage billing; you keep access until the end of the trial or of the period already paid. Apart from a withdrawal and other rights mandatory law gives you, payments are not refundable.',
    links: (t, p) => `Terms of Use: ${t}\nPrivacy Policy: ${p}`,
    monthly: 'monthly',
    yearly: 'yearly',
    perMonth: 'per month',
    perYear: 'per year',
  },
  es: {
    subject: 'Tu suscripción a Exama: confirmación',
    hello: (n) => `Hola, ${n}:`,
    started: (plan, period, date) => `Te confirmamos tu suscripción a Exama ${plan} (${period}), iniciada el ${date}.`,
    trial: (end, price) => `Tu prueba gratuita termina el ${end}. Salvo que canceles antes, a partir de esa fecha se te cobrarán ${price}, y la suscripción se renovará automáticamente hasta que la canceles.`,
    paid: (price) => `Se te cobran ${price}; la suscripción se renueva automáticamente hasta que la canceles.`,
    confirmed: 'Al pagar aceptaste la renovación automática y nos pediste que tu suscripción empezara de inmediato.',
    withdrawal: (d) =>
      `Si eres consumidor en la UE, el EEE o el Reino Unido, puedes desistir de este contrato en un plazo de 14 días, hasta el ${d}, sin necesidad de justificación. Si desistes cuando ya ha empezado el servicio de pago, pagas el servicio prestado hasta que desistas y te devolvemos el resto en un plazo de 14 días, con el mismo medio de pago. La prueba gratuita no se cobra.`,
    how: 'Para desistir, envíanos una declaración inequívoca, por ejemplo por correo electrónico a la dirección de contacto indicada en nuestras Condiciones de uso. Puedes utilizar este modelo de formulario:',
    formTitle: 'Modelo de formulario de desistimiento',
    form: [
      'A la atención de Exama (datos de contacto: véanse las Condiciones de uso):',
      'Por la presente le comunico que desisto de mi contrato de prestación del siguiente servicio: suscripción a Exama (plan: …)',
      'Pedido el: …',
      'Nombre del consumidor: …',
      'Correo electrónico de la cuenta de Exama: …',
      'Domicilio del consumidor: …',
      'Fecha: …',
    ],
    manage: 'Para que no se renueve, cancélala cuando quieras en Exama, en Cuenta → Gestionar facturación; conservas el acceso hasta el final de la prueba o del periodo ya pagado. Salvo el desistimiento y otros derechos que te reconozca la normativa imperativa, los pagos no son reembolsables.',
    links: (t, p) => `Condiciones de uso: ${t}\nPolítica de privacidad: ${p}`,
    monthly: 'mensual',
    yearly: 'anual',
    perMonth: 'al mes',
    perYear: 'al año',
  },
  fr: {
    subject: 'Votre abonnement Exama : confirmation',
    hello: (n) => `Bonjour ${n},`,
    started: (plan, period, date) => `Nous vous confirmons votre abonnement Exama ${plan} (${period}), démarré le ${date}.`,
    trial: (end, price) => `Votre essai gratuit se termine le ${end}. Sauf résiliation avant cette date, ${price} vous seront facturés à partir de cette date, puis l’abonnement se renouvellera automatiquement jusqu’à sa résiliation.`,
    paid: (price) => `${price} vous sont facturés ; l’abonnement se renouvelle automatiquement jusqu’à sa résiliation.`,
    confirmed: 'Lors du paiement, vous avez accepté le renouvellement automatique et nous avez demandé de démarrer votre abonnement immédiatement.',
    withdrawal: (d) =>
      `Si vous êtes un consommateur dans l’UE, l’EEE ou au Royaume-Uni, vous pouvez vous rétracter de ce contrat sans donner de motif dans un délai de 14 jours, jusqu’au ${d}. Si vous vous rétractez alors que le service payant a commencé, vous payez le service fourni jusqu’à votre rétractation et nous vous remboursons le reste dans un délai de 14 jours, avec le même moyen de paiement. L’essai gratuit n’est pas facturé.`,
    how: 'Pour vous rétracter, envoyez-nous une déclaration dénuée d’ambiguïté, par exemple par e-mail à l’adresse de contact indiquée dans nos Conditions d’utilisation. Vous pouvez utiliser ce modèle de formulaire :',
    formTitle: 'Modèle de formulaire de rétractation',
    form: [
      'À l’attention d’Exama (coordonnées : voir les Conditions d’utilisation) :',
      'Je vous notifie par la présente ma rétractation du contrat portant sur la prestation de services ci-dessous : abonnement Exama (offre : …)',
      'Commandé le : …',
      'Nom du consommateur : …',
      'Adresse e-mail du compte Exama : …',
      'Adresse du consommateur : …',
      'Date : …',
    ],
    manage: 'Pour arrêter le renouvellement, résiliez à tout moment dans Exama, sous Compte → Gérer la facturation ; vous conservez l’accès jusqu’à la fin de l’essai ou de la période déjà payée. En dehors d’une rétractation et des autres droits que vous confère le droit impératif, les paiements ne sont pas remboursables.',
    links: (t, p) => `Conditions d’utilisation : ${t}\nPolitique de confidentialité : ${p}`,
    monthly: 'mensuel',
    yearly: 'annuel',
    perMonth: 'par mois',
    perYear: 'par an',
  },
  ar: {
    subject: 'اشتراكك في Exama: تأكيد',
    hello: (n) => `مرحبًا ${n}،`,
    started: (plan, period, date) => `نؤكّد اشتراكك في Exama ${plan} (${period})، الذي بدأ في ${date}.`,
    trial: (end, price) => `تنتهي فترتك التجريبية المجانية في ${end}. ما لم تُلغِ الاشتراك قبل ذلك، سيُخصم منك ${price} اعتبارًا من ذلك التاريخ، ثم يتجدّد الاشتراك تلقائيًا حتى تلغيه.`,
    paid: (price) => `يُخصم منك ${price}، ويتجدّد الاشتراك تلقائيًا حتى تلغيه.`,
    confirmed: 'عند الدفع وافقت على التجديد التلقائي وطلبت منا بدء اشتراكك فورًا.',
    withdrawal: (d) =>
      `إذا كنت مستهلكًا في الاتحاد الأوروبي أو المنطقة الاقتصادية الأوروبية أو المملكة المتحدة، يحق لك العدول عن هذا العقد خلال 14 يومًا، حتى ${d}، دون إبداء أي سبب. إذا عدلت بعد بدء الخدمة المدفوعة، تدفع مقابل الخدمة المقدَّمة حتى عدولك ونردّ إليك الباقي خلال 14 يومًا بوسيلة الدفع نفسها. لا تُفرض أي رسوم على الفترة التجريبية المجانية.`,
    how: 'للعدول، أرسل إلينا بيانًا واضحًا، مثلًا عبر البريد الإلكتروني إلى عنوان التواصل المذكور في شروط الاستخدام. يمكنك استخدام هذا النموذج:',
    formTitle: 'نموذج العدول',
    form: [
      'إلى Exama (بيانات التواصل: راجع شروط الاستخدام):',
      'أُبلغكم بموجب هذا بعدولي عن عقدي لتقديم الخدمة التالية: اشتراك Exama (الخطة: …)',
      'تاريخ الطلب: …',
      'اسم المستهلك: …',
      'البريد الإلكتروني لحساب Exama: …',
      'عنوان المستهلك: …',
      'التاريخ: …',
    ],
    manage: 'لإيقاف التجديد، ألغِ الاشتراك في أي وقت في Exama من الحساب ← إدارة الفوترة، وتحتفظ بالوصول حتى نهاية الفترة التجريبية أو الفترة المدفوعة مسبقًا. باستثناء العدول والحقوق الأخرى التي يمنحك إياها القانون الإلزامي، لا تُردّ المبالغ المدفوعة.',
    links: (t, p) => `شروط الاستخدام: ${t}\nسياسة الخصوصية: ${p}`,
    monthly: 'شهري',
    yearly: 'سنوي',
    perMonth: 'شهريًا',
    perYear: 'سنويًا',
  },
};

const TIER_NAMES = { basic: 'Basic', student: 'Student', pro: 'Pro' } as const;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export type SubscriptionConfirmation = {
  to: string;
  name: string;
  language: Language;
  planId: PlanId;
  /** Contract concluded (subscription started). */
  startedAt: Date;
  /** End of the free trial, or null for a paid start. */
  trialEndsAt: Date | null;
  /** Price per period in minor units and its currency, as Stripe bills it (falls back to the list price). */
  unitAmount: number | null;
  currency: string | null;
  /** Origin of the web app, for links to the Terms and the Privacy Policy (none when not configured). */
  webAppUrl: string | null;
};

/** The confirmation email (text + simple HTML). Pure: everything it shows is passed in. */
export function subscriptionConfirmationEmail(c: SubscriptionConfirmation) {
  const t = COPY[c.language];
  const plan = planById(c.planId);
  const locale = c.language === 'ar' ? 'ar' : c.language;
  const date = (d: Date) => new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(d);
  const amount = c.unitAmount ?? plan.priceCents;
  const currency = (c.currency ?? plan.currency).toUpperCase();
  const money = new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount / 100);
  const price = `${money} ${plan.period === 'yearly' ? t.perYear : t.perMonth}`;
  const deadline = new Date(c.startedAt.getTime() + WITHDRAWAL_DAYS * 86_400_000);
  const terms = c.webAppUrl ? `${c.webAppUrl}/legal/terms` : null;
  const privacy = c.webAppUrl ? `${c.webAppUrl}/legal/privacy` : null;

  const paragraphs = [
    t.hello(c.name),
    t.started(TIER_NAMES[plan.tier], plan.period === 'yearly' ? t.yearly : t.monthly, date(c.startedAt)),
    c.trialEndsAt ? t.trial(date(c.trialEndsAt), price) : t.paid(price),
    t.confirmed,
    t.withdrawal(date(deadline)),
    t.how,
  ];
  const links = terms && privacy ? t.links(terms, privacy) : null;
  const text = [...paragraphs, `${t.formTitle}:`, ...t.form.map((l) => `- ${l}`), '', t.manage, ...(links ? ['', links] : []), '', `(${LEGAL_VERSION})`].join('\n\n').replace(/\n\n- /g, '\n- ');
  const dir = c.language === 'ar' ? ' dir="rtl"' : '';
  const html = `<div${dir} style="font-family:system-ui,sans-serif;line-height:1.5;color:#14161f">${paragraphs.map((p) => `<p>${esc(p)}</p>`).join('')}<p><strong>${esc(t.formTitle)}</strong></p><ul>${t.form.map((l) => `<li>${esc(l)}</li>`).join('')}</ul><p>${esc(t.manage)}</p>${terms && privacy ? `<p><a href="${esc(terms)}">${esc(terms)}</a><br><a href="${esc(privacy)}">${esc(privacy)}</a></p>` : ''}<p style="color:#5f657a;font-size:12px">${esc(LEGAL_VERSION)}</p></div>`;
  return { to: c.to, subject: t.subject, text, html };
}
