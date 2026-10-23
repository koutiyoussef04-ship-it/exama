/**
 * French copy of the "pour les organismes" pages (/fr/pour-les-organisations, /fr/pour-les-organisations/demo).
 * Same facts and rules as en.ts: only what the workspace does; no clients, logos, testimonials, counts, statistics,
 * time savings or guarantees. Terms match the app's French workspace (apps/mobile/src/i18n/locales/fr.ts):
 * organisme de formation, centre de préparation aux examens, brouillons de questions, relecteur, offre, pilote.
 */
import type { OrgCopy } from './types';

const n = (v: number) => new Intl.NumberFormat('fr-FR', { useGrouping: 'always' }).format(v);

export const frOrg: OrgCopy = {
  meta: {
    title: 'Exama pour les organismes — Des questions d’examen à partir de vos propres supports',
    description:
      'Pour les universités, les écoles, les centres de formation et les entreprises : importez vos supports de cours, recevez des brouillons de questions rédigés par l’IA avec leur source, relisez-les et approuvez-les en équipe, exportez-les vers Moodle ou en CSV. Offres mensuelles ou annuelles, activées par Exama.',
    demoTitle: 'Demander une démo — Exama pour les organismes',
    ogAlt: 'Exama pour les organismes : des questions d’examen à partir de vos propres supports, chacune avec sa source',
    demoDescription: 'Demandez par e-mail une présentation de l’espace de travail Exama pour les organismes, ou dites-nous quelle offre convient à votre organisme.',
  },
  nav: { how: 'Fonctionnement', pricing: 'Tarifs', faq: 'FAQ', students: 'Pour les étudiants', demo: 'Démo' },
  cta: { demo: 'Demander une démo', seePricing: 'Voir les offres et les tarifs', seeHow: 'Voir le fonctionnement', createAccount: 'Créer un compte organisation' },
  hero: {
    eyebrow: 'Pour les universités, les écoles, les centres de formation et les entreprises',
    titleStart: 'Transformez vos supports de cours en questions d’examen, ',
    titleHighlight: 'chacune avec sa source.',
    lead: 'Importez un PDF ou un PowerPoint. Exama rédige les questions et montre le passage dont chacune est tirée. Votre équipe relit et approuve chaque question avant de l’utiliser, puis les exporte vers Moodle ou en CSV.',
    note: 'Offres mensuelles ou annuelles · Prix hors TVA · Rien n’est facturé automatiquement',
    trustAria: 'Comment vos supports sont traités',
    trust: ['Données hébergées dans l’UE (Francfort)', 'Seul votre organisme voit ses supports', 'Rien n’est approuvé sans relecteur', 'Export à tout moment : Moodle GIFT ou CSV'],
    shotAlt: 'L’écran de relecture d’Exama : le passage source du cours à côté de la question rédigée, avec les boutons pour approuver ou rejeter',
    flowAria: 'Des supports de cours à une banque de questions relue : vos supports en entrée, des brouillons avec leur source, la relecture par votre équipe, l’export',
    flowIn: 'Vos supports',
    inputs: ['PDF de cours', 'Diapositives PowerPoint'],
    flowCore: 'Des brouillons avec leur source',
    flowCoreSub: 'Chaque question cite le passage sur lequel elle s’appuie',
    flowOut: 'Après votre relecture',
    outputs: ['Banque de questions approuvées', 'Export Moodle GIFT', 'Export CSV'],
  },
  audiences: {
    eyebrow: 'Pour qui',
    title: 'Tous les types d’organismes, un seul espace de travail',
    lead: 'En créant l’organisation, vous indiquez son type : université ou enseignement supérieur, école, centre de formation, entreprise, soutien scolaire ou préparation aux examens. L’espace de travail est le même pour tous.',
    items: [
      {
        title: 'Universités et établissements scolaires',
        text: 'Pour des cours enseignés à partir de votre propre programme, où l’équipe pédagogique garde la main sur chaque question.',
        icon: 'building',
        points: ['Questions à choix multiples et à réponse courte', 'Questions classées par module et par thème au sein de chaque cours', 'Chaque question affiche le passage sur lequel elle repose'],
      },
      {
        title: 'Centres de formation et entreprises',
        text: 'Pour les formations professionnelles et la formation des salariés construites à partir de vos propres modules.',
        icon: 'folder',
        points: ['Des brouillons à partir de PDF et de diapositives PowerPoint', 'Relus et approuvés par votre équipe avant toute utilisation', 'Des exports qui s’importent directement dans Moodle ou dans vos outils'],
      },
      {
        title: 'Soutien scolaire et préparation aux examens',
        text: 'Pour les centres qui préparent des élèves à un examen, où l’entraînement doit suivre le support de près.',
        icon: 'target',
        points: ['Des questions qui restent dans le support importé', 'Approuvez, rejetez ou modifiez chaque brouillon', 'Des relecteurs sans frais, dans toutes les offres'],
      },
    ],
  },
  how: {
    eyebrow: 'Fonctionnement',
    title: 'D’un fichier de cours à une banque de questions approuvées',
    lead: 'Quatre étapes, toutes dans l’espace de travail des organismes sur app.exama.app.',
    steps: [
      { title: 'Importez un cours', text: 'Un PDF ou un PowerPoint (.pptx) contenant du vrai texte. Exama le lit, le découpe en pages ou en diapositives et repère ses thèmes.', icon: 'upload' },
      { title: 'Rédigez des questions', text: 'Demandez jusqu’à 20 brouillons à la fois, pour tout le cours ou pour un thème. Chaque brouillon arrive avec le passage cité, sa page ou sa diapositive et des vérifications automatiques.', icon: 'sparkle' },
      { title: 'Relisez en équipe', text: 'La file de relecture affiche la source à côté de la question. Les relecteurs modifient, approuvent ou rejettent, une question après l’autre, avec des raccourcis clavier sur ordinateur.', icon: 'graded' },
      { title: 'Exportez ce qui est approuvé', text: 'Seules les questions approuvées sortent de l’espace de travail : Moodle GIFT ou CSV, pour un cours, un thème ou l’ensemble.', icon: 'export' },
    ],
  },
  review: {
    eyebrow: 'Sourcées, puis relues',
    title: 'Chaque question montre d’où elle vient',
    lead: 'Les brouillons sont rédigés uniquement à partir de vos supports, et non de ce qu’un modèle retient du sujet. Ensuite, c’est votre équipe qui décide.',
    points: [
      'Le passage cité est retrouvé dans votre cours, avec sa page ou sa diapositive, et surligné à côté de la question.',
      'Des vérifications automatiques signalent les brouillons dont la citation est introuvable ou ne correspond qu’approximativement, les réponses contenant des chiffres absents du passage et les distracteurs faibles des questions à choix multiples.',
      'Une seconde vérification lit le passage retrouvé et indique s’il étaye la réponse ; elle est indicative et affichée au relecteur.',
      'Rien n’est approuvé automatiquement. Un relecteur approuve chaque question qui entre dans la banque.',
    ],
    screens: [
      { id: 'org-review', title: 'Relecture côte à côte', text: 'Le passage source à gauche, la question modifiable à droite. Approuver, rejeter, ou approuver et passer à la suivante.', icon: 'quote', alt: 'L’écran de relecture d’Exama : le passage source cité à côté de la question modifiable, avec les boutons pour approuver ou rejeter' },
      { id: 'org-queue', title: 'File de relecture', text: 'Les brouillons dans un tableau avec recherche, filtrés par cours et par thème, en commençant par ceux qui demandent votre attention.', icon: 'search', alt: 'La file de relecture d’Exama : un tableau de brouillons de questions avec recherche et filtres par cours et par thème' },
      { id: 'org-dashboard', title: 'Tableau de bord et utilisation', text: 'Les cours, les brouillons à relire, les questions approuvées et les membres en un coup d’œil, ainsi que la part de l’offre déjà utilisée.', icon: 'chart', alt: 'Le tableau de bord de l’organisation dans Exama, avec le nombre de cours, de brouillons, de questions approuvées et de membres, et l’utilisation par rapport à l’offre' },
    ],
  },
  team: {
    eyebrow: 'Votre équipe',
    title: 'Des rôles qui correspondent à la fabrication d’une banque de questions',
    lead: 'Chaque membre se connecte avec son propre compte : chaque approbation porte donc un nom.',
    roles: [
      { name: 'Administrateur', text: 'Ajoute et retire des membres, change les rôles et les réglages, et fait tout ce que fait un éditeur.' },
      { name: 'Éditeur', text: 'Importe des cours, rédige des questions, ajoute des questions à la main, exporte et supprime.' },
      { name: 'Relecteur', text: 'Lit, modifie, approuve et rejette des questions. Rien d’autre.' },
    ],
    reviewersNote: 'Les offres comptent les administrateurs et les éditeurs. Les relecteurs sont illimités dans toutes les offres.',
    usageTitle: 'Une utilisation visible',
    usageText: 'Le tableau de bord indique les cours importés et les brouillons de questions générés par rapport à votre offre. L’espace de travail s’arrête à la limite ; il ne facture jamais de dépassement.',
  },
  pricing: {
    eyebrow: 'Tarifs',
    title: 'Des offres pour votre organisme',
    lead: 'Choisissez l’offre qui correspond à vos volumes. Exama l’active pour votre organisme une fois convenue avec vous. Il n’y a pas de paiement en ligne et rien n’est facturé automatiquement.',
    perMonth: '/mois',
    plusVat: '+ TVA',
    orYearly: (yearly, pct) => `ou ${yearly}/an + TVA (${pct}\u00a0% d’économie)`,
    custom: 'Sur mesure',
    customSub: 'tarif et volumes',
    plans: {
      esencial: {
        name: 'Esencial',
        tagline: 'Pour un centre ou un service.',
        features: (l, perRequest) => [`${n(l!.coursesPerMonth)} cours importés par mois`, `${n(l!.itemsPerMonth)} brouillons de questions par mois`, `${n(l!.maxMembers)} administrateurs ou éditeurs`, 'Relecteurs illimités', `Jusqu’à ${n(perRequest)} brouillons par demande`, 'Export Moodle GIFT et CSV'],
        cta: 'Demander Esencial',
      },
      profesional: {
        name: 'Profesional',
        tagline: 'Pour plusieurs cours menés en parallèle.',
        features: (l, perRequest) => [`${n(l!.coursesPerMonth)} cours importés par mois`, `${n(l!.itemsPerMonth)} brouillons de questions par mois`, `${n(l!.maxMembers)} administrateurs ou éditeurs`, 'Relecteurs illimités', `Jusqu’à ${n(perRequest)} brouillons par demande`, 'Export Moodle GIFT et CSV'],
        cta: 'Demander Profesional',
      },
      centro: {
        name: 'Centro',
        tagline: 'Pour les établissements qui ont leurs propres volumes.',
        features: () => ['Volumes de cours et de brouillons fixés avec vous', 'Places d’administrateur et d’éditeur fixées avec vous', 'Relecteurs illimités', 'Export Moodle GIFT et CSV'],
        cta: 'Nous contacter',
      },
    },
    vatNote: 'Prix hors TVA. La TVA est ajoutée au taux applicable lors de la facturation de l’offre.',
    billingNote: 'Les offres sont convenues par e-mail et activées par Exama ; vous n’êtes jamais facturé sans avoir demandé une offre.',
    pilotNote: {
      title: 'Envie de le voir d’abord avec vos propres supports ?',
      text: 'Demandez-nous une démo. Pour certains projets, nous pouvons convenir avec l’organisme d’un pilote pour une durée limitée ; nous étudions chaque demande au cas par cas.',
      cta: 'Nous contacter',
    },
  },
  start: {
    eyebrow: 'Pour commencer',
    title: 'D’un premier échange à votre espace de travail',
    lead: 'Les offres sont activées par Exama : pour commencer, il suffit d’un court échange avec nous.',
    steps: [
      { title: 'Présentez-nous votre organisme', text: 'Demandez une démo ou écrivez-nous : ce que vous enseignez, et combien de cours et de personnes sont concernés.', icon: 'mail' },
      { title: 'Convenons d’une offre', text: 'Esencial, Profesional ou Centro, mensuelle ou annuelle. Nous confirmons l’offre et ses conditions par e-mail.', icon: 'check' },
      { title: 'Créez le compte de l’organisation', text: 'Votre nom, votre e-mail, ainsi que le nom et le type de l’organisation. Confirmez votre e-mail avec le lien que nous vous envoyons.', icon: 'users' },
      { title: 'Nous activons votre offre', text: 'Une fois l’offre active, votre équipe peut importer des cours, rédiger des questions et ajouter des collègues comme éditeurs ou relecteurs.', icon: 'upload' },
    ],
    noPlanTitle: 'Avant l’activation d’une offre',
    noPlan: ['Le compte et l’espace de travail peuvent être créés à tout moment.', 'L’import de cours et la rédaction de questions commencent dès qu’Exama a activé une offre.', 'Rien n’est facturé : une offre n’est activée qu’après votre demande.'],
  },
  faq: {
    eyebrow: 'FAQ',
    title: 'Les questions des organismes',
    items: [
      {
        q: 'Que pouvons-nous importer ?',
        a: ['Des fichiers PDF et PowerPoint (.pptx) contenant du vrai texte. Les images numérisées sans couche de texte ne peuvent pas être lues. Chaque cours est un fichier ; vous pouvez importer autant de cours que votre offre le permet.'],
      },
      {
        q: 'Qu’est-ce qui compte comme un brouillon de question ?',
        a: [
          'Un brouillon est une question qu’Exama rédige et conserve pour votre relecture. Vous demandez un nombre de brouillons (jusqu’à 20 par demande) et seuls ceux qui sont livrés sont décomptés. Les questions que vos éditeurs ajoutent à la main ne comptent pas.',
          'Avec Esencial et Profesional, le volume s’entend par mois civil.',
        ],
      },
      {
        q: 'Les questions s’appuient-elles sur nos supports ?',
        a: [
          'Oui. Les brouillons sont rédigés uniquement à partir du texte du cours importé, et chacun cite le passage sur lequel il s’appuie, avec sa page ou sa diapositive. Les brouillons dont la citation est introuvable dans les supports sont signalés au relecteur.',
          'Cela reste un brouillon : un relecteur le lit, le modifie si nécessaire et l’approuve avant qu’il n’entre dans la banque.',
        ],
      },
      {
        q: 'Pouvons-nous modifier les questions, ou écrire les nôtres ?',
        a: ['Oui. Les relecteurs peuvent modifier n’importe quel brouillon avant de l’approuver. Les éditeurs peuvent ajouter des questions à la main ; elles passent par la même file de relecture que les questions rédigées.'],
      },
      {
        q: 'Comment importer les questions dans Moodle ?',
        a: ['Exportez les questions approuvées au format Moodle GIFT, puis importez le fichier dans une banque de questions Moodle. Un export CSV est aussi disponible pour d’autres outils. Les exports ne contiennent que des questions approuvées, pour un cours, un thème ou l’ensemble.'],
      },
      {
        q: 'Où nos supports sont-ils stockés, et qui les voit ?',
        a: [
          'Les cours, les questions et les comptes sont stockés sur des serveurs situés dans l’Union européenne (Francfort). Seuls les membres de votre organisme voient ses supports. Pour rédiger et vérifier les questions, les passages concernés sont envoyés à un fournisseur d’IA tiers (Anthropic) ; Exama n’utilise vos supports que pour rédiger et vérifier des questions pour votre organisme.',
          'Des conditions propres aux organismes et un accord de traitement des données sont en cours de finalisation ; demandez-les-nous lorsque vous demandez une offre.',
        ],
      },
      {
        q: 'Pouvons-nous essayer Exama avant de choisir une offre ?',
        a: ['Oui : demandez-nous une démo et nous vous montrerons l’espace de travail avec de vrais supports de cours. Pour certains projets, nous convenons aussi d’un pilote avec l’organisme, pour une durée limitée et avec des volumes définis. Les pilotes sont convenus au cas par cas ; ils ne sont pas proposés par défaut.'],
      },
      {
        q: 'Comment une offre est-elle payée ?',
        a: ['Demandez Esencial, Profesional ou Centro par e-mail. Nous convenons avec vous de l’offre et de la période de facturation, puis nous l’activons ; les prix s’entendent hors TVA. Il n’y a pas de paiement en ligne et rien n’est facturé automatiquement : ni au démarrage, ni au renouvellement.'],
      },
    ],
  },
  final: {
    title: 'Voyez-le avec l’un de vos cours.',
    text: 'Demandez une démo, ou dites-nous quelle offre convient à votre organisme.',
    note: 'Les offres sont activées par Exama. Rien n’est facturé automatiquement. Vos supports restent les vôtres.',
  },
  demo: {
    title: 'Demander une démo',
    intro: 'Présentez-nous votre organisme : nous vous répondrons par e-mail pour organiser une présentation de l’espace de travail, répondre à vos questions ou préparer une offre.',
    includeTitle: 'Utile à préciser',
    include: ['Votre organisme et ce qu’il enseigne (cours universitaires ou scolaires, formation professionnelle, formation des salariés, préparation aux examens…)', 'Avec combien de cours ou de modules vous commenceriez, et dans quel format', 'Combien de personnes importeraient des supports, rédigeraient et relieraient des questions', 'L’offre que vous envisagez, ou ce dont vous auriez besoin avec Centro'],
    emailButton: 'Écrire à contact@exama.app',
    emailHow: 'Le bouton ouvre votre messagerie avec un message prérempli. S’il ne s’ouvre pas, écrivez à l’adresse ci-dessous.',
    addressLead: 'Notre adresse pour les organismes :',
    subject: 'Exama pour les organismes — demande de démo',
    body: 'Bonjour Exama,\n\nNous aimerions une démo de l’espace de travail pour les organismes.\n\nOrganisme :\nCe que nous enseignons :\nCours ou modules pour commencer :\nPersonnes qui relieraient les questions :\nOffre envisagée :\n\nMerci,\n',
    replyNote: 'Nous répondons par e-mail. Demander une démo ne crée aucun compte et n’entraîne aucune facturation.',
    orTitle: 'Nous avons déjà convenu d’une offre ?',
    orText: 'Créez le compte de l’organisation et indiquez-nous son nom : nous activerons l’offre convenue.',
    back: '← Retour à Exama pour les organismes',
  },
  footer: {
    tagline: 'Des questions d’examen à partir de vos propres supports, chacune avec sa source, relues par votre équipe.',
    product: 'Pour les organismes',
    account: 'Compte',
    how: 'Fonctionnement',
    pricing: 'Tarifs',
    faq: 'FAQ',
    demo: 'Demander une démo',
    signup: 'Créer un compte organisation',
    students: 'Exama pour les étudiants',
  },
};
