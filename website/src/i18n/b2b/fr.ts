/**
 * French copy of the "pour les organismes" pages (/fr/pour-les-organismes, /fr/pour-les-organismes/demo), written for
 * the training organizations (organismes de formation) we write to: Qualiopi positioning, the free 2-week pilot,
 * exports for the audit file. Same facts and rules as en.ts: only what the workspace does; no clients, logos,
 * testimonials, counts, statistics, time savings or guarantees — and never that Exama certifies anyone, guarantees an
 * audit result, or tracks trainees' results (it does not). Terms match the app's French workspace
 * (apps/mobile/src/i18n/locales/fr.ts): organisme de formation, formateur, stagiaire, brouillons de questions,
 * relecteur, offre, pilote. Plan names = the app's org.plan.name (Indépendant · Essentiel · Professionnel ·
 * Établissement; the ids stay starter/esencial/profesional/centro).
 *
 * Qualiopi: the indicator numbers and wording below are quoted from the référentiel national qualité as annexed to
 * décret n° 2026-728 du 1er août 2026 (applicable to audits from 1 November 2026); indicators 8 and 11 have the same
 * wording in the previous version (décret n° 2019-565). Check the official text again before changing them.
 * "2 semaines" = ORG_PILOT_DAYS (14) in src/data/b2b.ts; check-pricing.mjs fails if the two drift.
 */
import type { OrgCopy } from './types';

const n = (v: number) => new Intl.NumberFormat('fr-FR', { useGrouping: 'always' }).format(v);
const EXPORTS = 'Export PDF (stagiaire et formateur), Excel, CSV et Moodle GIFT';

export const frOrg: OrgCopy = {
  meta: {
    title: 'Exama pour les organismes de formation — Vos supports deviennent des évaluations sourcées',
    description:
      'Pour les organismes de formation : importez vos supports (PDF ou PowerPoint), recevez des questions rédigées uniquement à partir de ces supports, avec le passage et la page cités ; chaque question est validée par un formateur nommé, puis exportée en PDF stagiaire ou formateur, Excel, CSV ou Moodle GIFT pour votre dossier Qualiopi. Pilote gratuit de 2 semaines, sans engagement ni carte bancaire.',
    demoTitle: 'Demander un pilote gratuit de 2 semaines — Exama pour les organismes de formation',
    ogAlt: 'Exama pour les organismes de formation : vos supports deviennent des évaluations sourcées, validées par un formateur, prêtes pour votre audit Qualiopi',
    demoDescription: 'Demandez par e-mail, ou en réservant un créneau, un pilote gratuit de 2 semaines de l’espace de travail Exama, ouvert au nom de votre organisme, sans engagement ni carte bancaire.',
  },
  nav: { how: 'Fonctionnement', pricing: 'Tarifs', faq: 'FAQ', students: 'Pour les étudiants', demo: 'Pilote gratuit' },
  cta: { demo: 'Demander un pilote gratuit de 2 semaines', seePricing: 'Voir les tarifs', seeHow: 'Voir le fonctionnement', createAccount: 'Créer un compte organisme' },
  hero: {
    eyebrow: 'Pour les organismes de formation',
    titleStart: 'Vos supports de formation deviennent des évaluations sourcées, ',
    titleHighlight: 'prêtes pour votre audit Qualiopi.',
    lead: 'Importez vos supports, en PDF ou en PowerPoint. Exama rédige des questions à partir de ces seuls supports et montre, pour chacune, le passage et la page dont elle est tirée. Un formateur relit et approuve chaque question, puis vous exportez vos positionnements et vos évaluations de fin de formation en PDF, Excel, CSV ou Moodle GIFT.',
    note: 'Pilote gratuit de 2 semaines · Sans engagement ni carte bancaire · Offres mensuelles ou annuelles, prix hors TVA',
    trustAria: 'Comment vos supports sont traités',
    trust: ['Données hébergées dans l’UE (Francfort)', 'Seul votre organisme voit ses supports', 'Rien n’est approuvé sans un formateur', 'Export à tout moment : PDF, Excel, CSV ou Moodle GIFT'],
    shotAlt: 'L’écran de relecture d’Exama : le passage du support surligné à côté de la question rédigée, avec la correspondance de la citation et les boutons pour approuver ou rejeter',
    flowAria: 'De vos supports de formation à des évaluations relues : vos supports en entrée, des questions avec leur source, la relecture par un formateur, les exports',
    flowIn: 'Vos supports',
    inputs: ['Supports PDF', 'Diapositives PowerPoint'],
    flowCore: 'Des questions avec leur source',
    flowCoreSub: 'Chaque question cite le passage et la page dont elle est tirée',
    flowOut: 'Après relecture par un formateur',
    outputs: ['Banque de questions approuvées', 'PDF stagiaire et PDF formateur', 'Excel, CSV ou Moodle GIFT'],
  },
  qualiopi: {
    eyebrow: 'Qualiopi',
    title: 'Ce que le référentiel demande, et ce qu’Exama vous apporte',
    lead: 'Le référentiel national qualité attend de chaque organisme des procédures de positionnement et d’évaluation des acquis, et des éléments de preuve qu’elles sont appliquées. Exama ne se substitue pas à votre démarche qualité : il produit les évaluations et les traces qui l’alimentent.',
    requirementsTitle: 'Ce que demande le référentiel',
    requirements: [
      { title: 'Indicateur 8 — positionnement et acquis à l’entrée', text: '« Le prestataire détermine les procédures de positionnement et d’évaluation des acquis à l’entrée de la prestation. »' },
      { title: 'Indicateur 11 — atteinte des objectifs', text: '« Le prestataire évalue l’atteinte par les publics bénéficiaires des objectifs de la prestation. »' },
      { title: 'Des preuves à présenter à l’audit', text: 'Chaque indicateur s’apprécie sur des éléments de preuve : les questionnaires utilisés, leur lien avec le contenu de la formation, et qui les a validés.' },
    ],
    helpsTitle: 'Ce qu’Exama fait pour vous',
    helps: [
      { title: 'Des questions issues de vos seuls supports', text: 'Chaque question est rédigée à partir du support importé et affiche le passage cité, avec sa page ou sa diapositive. Rien ne vient d’un contenu générique.', icon: 'quote' },
      { title: 'Chaque question validée par un formateur nommé', text: 'Rien n’est approuvé automatiquement. L’approbation porte le nom du formateur et sa date, et l’historique des versions de chaque question est conservé.', icon: 'graded' },
      { title: 'Des quiz de positionnement et de fin de formation', text: 'Composez vos positionnements à l’entrée et vos évaluations de fin de formation à partir des questions approuvées, par module, par thème ou pour l’ensemble du support.', icon: 'target' },
      { title: 'Des exports PDF pour le dossier d’audit', text: 'Une version stagiaire (les questions seules) et une version formateur (avec le corrigé), à joindre à vos éléments de preuve avec la liste des questions approuvées.', icon: 'export' },
    ],
    note: 'Formulation des indicateurs : référentiel national qualité annexé au décret n° 2026-728 du 1er août 2026, applicable aux audits à partir du 1er novembre 2026 (les indicateurs 8 et 11 ont la même formulation dans la version précédente). Exama ne certifie aucun organisme, ne préjuge pas du résultat d’un audit et ne suit pas les résultats des stagiaires : la correction et le suivi des acquis restent dans vos outils.',
  },
  audiences: {
    eyebrow: 'Pour qui',
    title: 'Pour les organismes de formation, quelle que soit leur taille',
    lead: 'En créant le compte, vous indiquez le type de votre organisme : centre de formation, entreprise, préparation aux examens, université ou école. L’espace de travail est le même pour tous.',
    items: [
      {
        title: 'Organismes de formation',
        text: 'Pour les formations professionnelles construites à partir de vos propres modules, où le formateur garde la main sur chaque question.',
        icon: 'folder',
        points: ['Questions à choix multiples et à réponse courte', 'Questions classées par module et par thème au sein de chaque support', 'Chaque question affiche le passage et la page sur lesquels elle repose'],
      },
      {
        title: 'Formateurs indépendants',
        text: 'Pour un formateur qui anime ses propres formations et doit produire des positionnements et des évaluations à partir de ses supports.',
        icon: 'users',
        points: ['L’offre Indépendant, à partir de vos supports PDF et PowerPoint', 'Vous relisez et approuvez vous-même chaque question', 'Des exports PDF prêts à distribuer, stagiaire et formateur'],
      },
      {
        title: 'Centres de préparation aux examens',
        text: 'Pour les centres qui préparent des candidats à un examen, où l’entraînement doit suivre le support de près.',
        icon: 'target',
        points: ['Des questions qui restent dans le support importé', 'Approuvez, rejetez ou modifiez chaque brouillon', 'Des relecteurs sans frais, dans toutes les offres'],
      },
    ],
  },
  how: {
    eyebrow: 'Fonctionnement',
    title: 'D’un support de formation à une banque de questions approuvées',
    lead: 'Quatre étapes, toutes dans l’espace de travail des organismes sur app.exama.app.',
    steps: [
      { title: 'Importez un support', text: 'Un PDF ou un PowerPoint (.pptx) contenant du vrai texte. Exama le lit, le découpe en pages ou en diapositives et repère ses thèmes.', icon: 'upload' },
      { title: 'Rédigez des questions', text: 'Demandez jusqu’à 20 brouillons à la fois, pour tout le support ou pour un thème. Chaque brouillon arrive avec le passage cité, sa page ou sa diapositive et des vérifications automatiques.', icon: 'sparkle' },
      { title: 'Faites relire par un formateur', text: 'La file de relecture affiche la source à côté de la question. Le formateur modifie, approuve ou rejette, une question après l’autre, avec des raccourcis clavier sur ordinateur.', icon: 'graded' },
      { title: 'Exportez ce qui est approuvé', text: 'Seules les questions approuvées sortent de l’espace de travail : PDF stagiaire ou formateur, Excel, CSV ou Moodle GIFT, pour un support, un thème ou l’ensemble.', icon: 'export' },
    ],
  },
  review: {
    eyebrow: 'Sourcées, puis relues',
    title: 'Chaque question montre d’où elle vient',
    lead: 'Les brouillons sont rédigés uniquement à partir de vos supports, et non de ce qu’un modèle retient du sujet. Ensuite, c’est votre formateur qui décide.',
    points: [
      'Le passage cité est retrouvé dans votre support, avec sa page ou sa diapositive, et surligné à côté de la question.',
      'Des vérifications automatiques signalent les brouillons dont la citation est introuvable ou ne correspond qu’approximativement, les réponses contenant des chiffres absents du passage et les distracteurs faibles des questions à choix multiples.',
      'Une seconde vérification lit le passage retrouvé et indique s’il étaye la réponse ; elle est indicative et affichée au relecteur.',
      'Rien n’est approuvé automatiquement. Un formateur approuve chaque question qui entre dans la banque, sous son nom et à une date conservée.',
    ],
    screens: [
      { id: 'org-review-fr', title: 'Relecture côte à côte', text: 'Le passage du support à gauche, la question modifiable à droite, avec la correspondance de la citation. Approuver, rejeter, ou approuver et passer à la suivante.', icon: 'quote', alt: 'L’écran de relecture d’Exama : le passage du support surligné à côté de la question modifiable, avec la correspondance de la citation et les boutons pour approuver ou rejeter' },
      { id: 'org-queue-fr', title: 'File de relecture', text: 'Les questions dans un tableau avec recherche, filtrées par support et par thème, avec l’état des vérifications de chacune.', icon: 'search', alt: 'La file de relecture d’Exama : un tableau de questions avec recherche, filtres par support et par thème, et l’état des vérifications' },
      { id: 'org-dashboard-fr', title: 'Tableau de bord et utilisation', text: 'Les supports, les brouillons à relire, les questions approuvées et les membres en un coup d’œil, ainsi que la part de l’offre déjà utilisée.', icon: 'chart', alt: 'Le tableau de bord de l’organisme dans Exama, avec le nombre de supports, de brouillons, de questions approuvées et de membres, et l’utilisation par rapport à l’offre' },
    ],
  },
  exports: {
    eyebrow: 'Exports',
    title: 'Vos questions, dans le format dont vous avez besoin',
    lead: 'Seules les questions approuvées sortent de l’espace de travail, pour un support, un module ou l’ensemble. Quatre formats, à tout moment, dans toutes les offres.',
    items: [
      { title: 'PDF stagiaire', text: 'Les questions seules, à distribuer en salle ou à distance pour un positionnement ou une évaluation de fin de formation.', icon: 'pdf' },
      { title: 'PDF formateur', text: 'Les mêmes questions avec le corrigé, pour la correction et pour vos éléments de preuve.', icon: 'graded' },
      { title: 'Excel', text: 'Un classeur avec les questions, les réponses et le passage source, pour relire, trier ou reprendre les questions dans vos propres documents.', icon: 'chart' },
      { title: 'CSV et Moodle GIFT', text: 'Le CSV pour vos autres outils ; le fichier GIFT s’importe directement dans une banque de questions Moodle.', icon: 'export' },
    ],
    note: 'Les exports contiennent le texte des questions, les réponses et la source de chacune ; Exama ne stocke aucun résultat de stagiaire.',
  },
  team: {
    eyebrow: 'Votre équipe',
    title: 'Des rôles qui correspondent à la fabrication d’une banque de questions',
    lead: 'Chaque membre se connecte avec son propre compte : chaque approbation porte donc un nom.',
    roles: [
      { name: 'Administrateur', text: 'Ajoute et retire des membres, change les rôles et les réglages, et fait tout ce que fait un éditeur.' },
      { name: 'Éditeur', text: 'Importe des supports, rédige des questions, ajoute des questions à la main, exporte et supprime.' },
      { name: 'Relecteur', text: 'Lit, modifie, approuve et rejette des questions. Rien d’autre : le rôle d’un formateur qui valide.' },
    ],
    reviewersNote: 'Les offres comptent les administrateurs et les éditeurs. Les relecteurs sont illimités dans toutes les offres.',
    usageTitle: 'Une utilisation visible',
    usageText: 'Le tableau de bord indique les supports importés et les brouillons de questions générés par rapport à votre offre. L’espace de travail s’arrête à la limite ; il ne facture jamais de dépassement.',
  },
  pricing: {
    eyebrow: 'Tarifs',
    title: 'Des offres pour votre organisme',
    lead: 'Choisissez l’offre qui correspond à vos volumes. Exama l’active pour votre organisme une fois convenue avec vous. Il n’y a pas de paiement en ligne et rien n’est facturé automatiquement.',
    perMonth: '/mois',
    plusVat: '+ TVA',
    orYearly: (yearly, pct) => `ou ${yearly}/an + TVA (${pct} % d’économie)`,
    custom: 'Sur mesure',
    customSub: 'tarif et volumes',
    plans: {
      starter: {
        name: 'Indépendant',
        tagline: 'Pour les formateurs indépendants et les petits organismes.',
        features: (l, perRequest) => [`${n(l!.coursesPerMonth)} supports importés par mois`, `${n(l!.itemsPerMonth)} brouillons de questions par mois`, `${n(l!.maxMembers)} administrateurs ou éditeurs`, 'Relecteurs illimités', `Jusqu’à ${n(perRequest)} brouillons par demande`, EXPORTS],
        cta: 'Demander Indépendant',
      },
      esencial: {
        name: 'Essentiel',
        tagline: 'Pour un organisme ou un service.',
        features: (l, perRequest) => [`${n(l!.coursesPerMonth)} supports importés par mois`, `${n(l!.itemsPerMonth)} brouillons de questions par mois`, `${n(l!.maxMembers)} administrateurs ou éditeurs`, 'Relecteurs illimités', `Jusqu’à ${n(perRequest)} brouillons par demande`, EXPORTS],
        cta: 'Demander Essentiel',
      },
      profesional: {
        name: 'Professionnel',
        tagline: 'Pour plusieurs formations menées en parallèle.',
        features: (l, perRequest) => [`${n(l!.coursesPerMonth)} supports importés par mois`, `${n(l!.itemsPerMonth)} brouillons de questions par mois`, `${n(l!.maxMembers)} administrateurs ou éditeurs`, 'Relecteurs illimités', `Jusqu’à ${n(perRequest)} brouillons par demande`, EXPORTS],
        cta: 'Demander Professionnel',
      },
      centro: {
        name: 'Établissement',
        tagline: 'Pour les établissements qui ont leurs propres volumes.',
        features: () => ['Volumes de supports et de brouillons fixés avec vous', 'Places d’administrateur et d’éditeur fixées avec vous', 'Relecteurs illimités', EXPORTS],
        cta: 'Nous contacter',
      },
    },
    mostChosen: 'Le plus choisi',
    vatNote: 'Prix hors TVA. La TVA est ajoutée au taux applicable lors de la facturation de l’offre.',
    billingNote: 'Les offres sont convenues par e-mail et activées par Exama ; vous n’êtes jamais facturé sans avoir demandé une offre.',
    pilotNote: {
      title: 'Pilote gratuit de 2 semaines',
      text: 'Ouvert au nom de votre organisme, activé par nos soins, sans engagement ni carte bancaire. Pendant deux semaines, votre équipe importe ses propres supports, rédige, relit et exporte comme avec une offre active.',
      points: ['Ouvert au nom de votre organisme', 'Activé par nos soins', 'Sans engagement ni carte bancaire', 'À la fin du pilote, vos questions restent consultables et exportables ; rien n’est facturé'],
      cta: 'Demander un pilote gratuit de 2 semaines',
    },
  },
  start: {
    eyebrow: 'Pour commencer',
    title: 'D’une demande de pilote à votre espace de travail',
    lead: 'Le pilote et les offres sont activés par Exama : pour commencer, il suffit d’un e-mail ou d’un créneau réservé.',
    steps: [
      { title: 'Demandez un pilote', text: 'Écrivez-nous ou réservez un créneau : votre organisme, ce que vous formez, et les supports avec lesquels vous commenceriez.', icon: 'mail' },
      { title: 'Créez le compte de l’organisme', text: 'Votre nom, votre e-mail, ainsi que le nom et le type de l’organisme. Confirmez votre e-mail avec le lien que nous vous envoyons.', icon: 'users' },
      { title: 'Nous ouvrons le pilote', text: 'Deux semaines, au nom de votre organisme, sans engagement ni carte bancaire. Votre équipe importe ses supports, rédige, relit et exporte.', icon: 'check' },
      { title: 'Choisissez une offre, si vous le souhaitez', text: 'Indépendant, Essentiel, Professionnel ou Établissement, mensuelle ou annuelle. Nous confirmons l’offre et ses conditions par e-mail, puis nous l’activons.', icon: 'upload' },
    ],
    noPlanTitle: 'Pendant et après le pilote',
    noPlan: ['Le compte et l’espace de travail peuvent être créés à tout moment.', 'À la fin du pilote, vos supports et vos questions restent consultables et exportables ; l’import et la rédaction reprennent dès qu’une offre est active.', 'Rien n’est facturé : une offre n’est activée qu’après votre demande.'],
  },
  faq: {
    eyebrow: 'FAQ',
    title: 'Les questions des organismes de formation',
    items: [
      {
        q: 'Que pouvons-nous importer ?',
        a: ['Des fichiers PDF et PowerPoint (.pptx) contenant du vrai texte. Les images numérisées sans couche de texte ne peuvent pas être lues. Chaque support est un fichier ; vous pouvez importer autant de supports que votre offre le permet.'],
      },
      {
        q: 'Et si nos supports sont en Word ?',
        a: ['Pour l’instant, Exama lit les PDF et les PowerPoint. Enregistrez votre document Word en PDF (Fichier › Enregistrer sous › PDF) et importez ce PDF : le texte est conservé et les passages cités renvoient aux pages du PDF.'],
      },
      {
        q: 'Exama suffit-il pour Qualiopi ?',
        a: [
          'Non, et aucun outil ne le peut : la certification porte sur les processus de votre organisme et sur les preuves que vous présentez. Exama vous apporte des évaluations rédigées à partir de vos propres supports, validées par un formateur nommé et datées, exportables en PDF pour vos éléments de preuve.',
          'Exama ne certifie aucun organisme et ne préjuge pas du résultat d’un audit.',
        ],
      },
      {
        q: 'Qu’est-ce qui compte comme un brouillon de question ?',
        a: [
          'Un brouillon est une question qu’Exama rédige et conserve pour votre relecture. Vous demandez un nombre de brouillons (jusqu’à 20 par demande) et seuls ceux qui sont livrés sont décomptés. Les questions que vos éditeurs ajoutent à la main ne comptent pas.',
          'Avec Indépendant, Essentiel et Professionnel, le volume s’entend par mois civil.',
        ],
      },
      {
        q: 'Les questions s’appuient-elles sur nos supports ?',
        a: [
          'Oui. Les brouillons sont rédigés uniquement à partir du texte du support importé, et chacun cite le passage sur lequel il s’appuie, avec sa page ou sa diapositive. Les brouillons dont la citation est introuvable dans le support sont signalés au relecteur.',
          'Cela reste un brouillon : un formateur le lit, le modifie si nécessaire et l’approuve avant qu’il n’entre dans la banque.',
        ],
      },
      {
        q: 'Pouvons-nous modifier les questions, ou écrire les nôtres ?',
        a: ['Oui. Les relecteurs peuvent modifier n’importe quel brouillon avant de l’approuver. Les éditeurs peuvent ajouter des questions à la main ; elles passent par la même file de relecture que les questions rédigées.'],
      },
      {
        q: 'Dans quels formats exportez-vous ?',
        a: ['En PDF, en deux versions : stagiaire (les questions seules) et formateur (avec le corrigé). En Excel et en CSV pour vos propres documents et vos autres outils. En Moodle GIFT, à importer dans une banque de questions Moodle. Les exports ne contiennent que des questions approuvées, pour un support, un thème ou l’ensemble.'],
      },
      {
        q: 'Où nos supports sont-ils stockés, et qui les voit ?',
        a: [
          'Les supports, les questions et les comptes sont stockés sur des serveurs situés dans l’Union européenne (Francfort). Seuls les membres de votre organisme voient ses supports. Pour rédiger et vérifier les questions, les passages concernés sont envoyés à un fournisseur d’IA tiers (Anthropic) ; Exama n’utilise vos supports que pour rédiger et vérifier des questions pour votre organisme.',
          'Des conditions propres aux organismes et un accord de traitement des données sont en cours de finalisation ; demandez-les-nous lorsque vous demandez un pilote ou une offre.',
        ],
      },
      {
        q: 'Comment fonctionne le pilote gratuit de 2 semaines ?',
        a: ['Vous nous écrivez ou réservez un créneau, vous créez le compte de l’organisme, et nous ouvrons le pilote à son nom : deux semaines, sans engagement ni carte bancaire, avec vos propres supports. À la fin, vos supports et vos questions restent consultables et exportables ; rien n’est facturé et aucune offre n’est activée sans votre demande.'],
      },
      {
        q: 'Exama suit-il les résultats des stagiaires ?',
        a: ['Pas encore. Exama produit et exporte les évaluations ; la correction, les notes et le suivi des acquis restent dans vos outils.'],
      },
      {
        q: 'Comment une offre est-elle payée, et avec quelle TVA ?',
        a: ['Demandez Indépendant, Essentiel, Professionnel ou Établissement par e-mail. Nous convenons avec vous de l’offre et de la période de facturation, puis nous l’activons. Les prix s’affichent hors TVA ; la TVA au taux applicable est ajoutée sur la facture. Il n’y a pas de paiement en ligne et rien n’est facturé automatiquement : ni au démarrage, ni au renouvellement.'],
      },
    ],
  },
  final: {
    title: 'Essayez-le avec l’un de vos supports.',
    text: 'Demandez un pilote gratuit de 2 semaines, ou dites-nous quelle offre convient à votre organisme.',
    note: 'Pilote ouvert au nom de votre organisme, activé par nos soins. Sans engagement ni carte bancaire. Vos supports restent les vôtres.',
  },
  demo: {
    title: 'Demander un pilote gratuit de 2 semaines',
    intro: 'Présentez-nous votre organisme. Le pilote est ouvert au nom de votre organisme et activé par nos soins, sans engagement ni carte bancaire. Nous pouvons aussi vous montrer l’espace de travail avec l’un de vos supports.',
    includeTitle: 'Utile à préciser',
    include: ['Votre organisme et ce que vous formez (formation professionnelle, formation des salariés, préparation aux examens, cours universitaires ou scolaires…)', 'Avec combien de supports ou de modules vous commenceriez, et dans quel format', 'Combien de personnes importeraient des supports, rédigeraient et relieraient des questions', 'L’offre que vous envisagez après le pilote, ou ce dont vous auriez besoin avec Établissement'],
    emailButton: 'Écrire à contact@exama.app',
    emailHow: 'Le bouton ouvre votre messagerie avec un message prérempli. S’il ne s’ouvre pas, écrivez à l’adresse ci-dessous.',
    addressLead: 'Notre adresse pour les organismes :',
    subject: 'Exama — demande de pilote gratuit de 2 semaines',
    body: 'Bonjour Exama,\n\nNous souhaitons ouvrir un pilote gratuit de 2 semaines pour notre organisme.\n\nOrganisme :\nCe que nous formons :\nSupports ou modules pour commencer :\nPersonnes qui relieraient les questions :\nOffre envisagée après le pilote :\n\nMerci,\n',
    replyNote: 'Nous répondons par e-mail et ouvrons le pilote au nom de votre organisme. Demander un pilote ne crée aucun compte et n’entraîne aucune facturation.',
    booking: {
      title: 'Vous préférez un échange de 20 minutes ?',
      text: 'Réservez un créneau : nous vous montrons l’espace de travail avec l’un de vos supports et ouvrons le pilote dans la foulée.',
      button: 'Réserver un créneau',
    },
    orTitle: 'Le pilote ou une offre est déjà convenu ?',
    orText: 'Créez le compte de l’organisme et indiquez-nous son nom : nous activerons le pilote ou l’offre convenue.',
    back: '← Retour à Exama pour les organismes',
  },
  footer: {
    tagline: 'Des évaluations sourcées à partir de vos propres supports, validées par un formateur, exportées pour votre dossier Qualiopi.',
    product: 'Pour les organismes de formation',
    account: 'Compte',
    how: 'Fonctionnement',
    pricing: 'Tarifs',
    faq: 'FAQ',
    demo: 'Demander un pilote gratuit',
    signup: 'Créer un compte organisme',
    students: 'Exama pour les étudiants',
  },
};
