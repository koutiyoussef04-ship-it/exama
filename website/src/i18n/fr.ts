import type { Copy } from './types';

/** Français. Mêmes faits que la version anglaise (src/i18n/en.ts). */
export const fr: Copy = {
  meta: {
    title: 'Exama — Votre coach d’examen IA',
    description: 'Transformez vos supports de cours en examens personnalisés, corrections, entraînement ciblé sur vos points faibles et plan de révision.',
    ogAlt: 'Exama : transformez vos supports de cours en coach d’examen IA personnel.',
  },
  ui: { skip: 'Aller au contenu', menu: 'Menu', homeAria: 'Exama — accueil', language: 'Langue', primaryNav: 'Navigation principale', mobileNav: 'Navigation mobile' },
  nav: { how: 'Fonctionnement', materials: 'Supports', pricing: 'Tarifs', faq: 'FAQ', login: 'Se connecter' },
  cta: {
    trial: (days) => `Commencez votre essai gratuit de ${days} jours`,
    free: 'Commencer gratuitement',
    secondary: 'Voir le fonctionnement',
    choose: (plan) => `Choisir ${plan}`,
    startFree: 'Commencer gratuitement',
  },
  hero: {
    eyebrow: 'La préparation aux examens par l’IA, pour les étudiants',
    titleStart: 'Transformez vos supports de cours en ',
    titleHighlight: 'coach d’examen IA personnel.',
    lead: 'Importez votre PDF, PowerPoint, audio ou vidéo. Exama transforme vos supports de cours en examens personnalisés, corrections, entraînement sur vos points faibles et plan de révision.',
    noteTrial: (days) => `${days} jours gratuits · Carte demandée, aucun paiement aujourd’hui · Résiliable à tout moment avant la fin`,
    noteFree: 'Offre gratuite · Sans carte',
    formatsAria: 'Supports compatibles',
    formats: { pdf: 'PDF', slides: 'PowerPoint', audio: 'Audio', video: 'Vidéo' },
    outputs: ['Examens personnalisés', 'Correction et commentaires', 'Entraînement sur les points faibles', 'Plan de révision'],
    flowAria: 'Schéma : vos PDF, PowerPoint, audios et vidéos entrent dans Exama, qui les transforme en examens personnalisés, corrections, entraînement sur vos points faibles et plan de révision.',
    flowIn: 'Vos supports de cours',
    flowCore: 'Exama les comprend',
    flowCoreSub: 'Thèmes, points clés et définitions tirés de vos propres supports',
    flowOut: 'Ce que vous obtenez',
  },
  how: {
    eyebrow: 'Fonctionnement',
    title: 'Des supports de cours à l’examen, en six étapes',
    steps: [
      { title: 'Importez', text: 'Ajoutez un PDF, un PowerPoint, un audio ou une vidéo de votre cours.', icon: 'upload' },
      { title: 'Exama comprend vos supports', text: 'Il lit ou transcrit tout et repère les thèmes abordés par votre cours.', icon: 'sparkle' },
      { title: 'Passez un examen personnalisé', text: 'Recevez des QCM et des questions à réponse courte rédigés à partir de vos supports.', icon: 'exam' },
      { title: 'Obtenez votre correction', text: 'Consultez votre note et un commentaire sur chaque réponse, avec le passage d’où elle provient.', icon: 'graded' },
      { title: 'Travaillez vos points faibles', text: 'Exama suit chaque thème d’après vos résultats et vous entraîne sur ceux qui vous posent problème.', icon: 'target' },
      { title: 'Suivez votre plan de révision', text: 'Un plan jour par jour jusqu’à la date de votre examen, qui s’adapte au fil de vos révisions.', icon: 'calendar' },
    ],
  },
  materials: {
    eyebrow: 'Supports compatibles',
    title: 'Apportez tout ce qui compose votre cours',
    lead: 'PDF, diapositives, enregistrements et vidéos de cours alimentent le même cours. Vos examens, votre entraînement et votre plan de révision utilisent tout ce que vous ajoutez.',
    items: [
      { name: 'PDF', icon: 'pdf', formats: '.pdf', text: 'Notes de cours, chapitres de manuel, notes tapées. Fonctionne mieux avec du texte sélectionnable : les PDF scannés ou composés uniquement d’images ne sont pas encore pris en charge.' },
      { name: 'PowerPoint', icon: 'slides', formats: '.pptx', text: 'Les diapositives de vos cours. Les diapositives composées uniquement d’images ne sont pas encore prises en charge. Un ancien .ppt ? Enregistrez-le d’abord en .pptx ou en PDF.' },
      { name: 'Audio', icon: 'audio', formats: 'MP3 · M4A · WAV', text: 'Enregistrements de cours. Exama transcrit le cours, puis repère les thèmes qu’il enseigne.' },
      { name: 'Vidéo', icon: 'video', formats: 'MP4 · MOV', text: 'Vidéos de cours. Exama utilise ce qui est dit : les diapositives ou schémas montrés sans être commentés à l’oral ne sont pas pris en compte.' },
    ],
    fineTrial: 'Les cours audio et vidéo sont inclus dans Student et Pro, y compris pendant leur essai gratuit. Free comprend un cours enregistré par compte. Basic couvre les PDF et PowerPoint.',
    fineFree: 'Les cours audio et vidéo sont inclus dans Student et Pro. Free comprend un cours enregistré par compte. Basic couvre les PDF et PowerPoint.',
  },
  grounded: {
    eyebrow: 'Apprendre à partir de vos sources',
    title: 'Vos supports, pas une IA générique',
    lead: 'Exama ne vous interroge pas sur ce qu’une IA sait par hasard. Il construit questions et exercices à partir de ce que votre cours enseigne réellement : vos diapositives, vos notes, vos cours enregistrés.',
    points: [
      'Chaque question est vérifiée par rapport à vos supports. Si elle ne peut pas être rattachée à un passage, elle est écartée.',
      'Vos résultats indiquent le passage dont provient chaque question, pour que vous voyiez d’où vient la réponse.',
      'Les cours enregistrés sont transcrits et analysés comme les documents.',
      'Révisez en français, anglais, espagnol ou arabe, même si vos supports sont dans une autre langue.',
    ],
    disclaimer: 'Exama est une IA et peut se tromper. Vérifiez les informations importantes dans votre cours.',
    contrastAria: 'Questions génériques comparées aux questions d’Exama',
    genericLabel: 'Questions génériques',
    genericText: 'Rédigées à partir de connaissances générales. Elles peuvent porter sur des notions que votre enseignant n’a jamais abordées.',
    examaLabel: 'Questions d’Exama',
    examaText: 'Rédigées à partir de vos diapositives, notes et cours enregistrés, chacune rattachée à un passage de vos supports.',
    sourceNote: 'Le passage source s’affiche avec vos résultats',
  },
  exams: {
    eyebrow: 'Examens personnalisés',
    title: 'Un examen conçu à partir de votre cours',
    lead: 'Choisissez un cours et Exama rédige l’examen à partir de vos supports. Répondez, envoyez, et obtenez votre correction.',
    pipelineAria: 'Déroulement d’un examen',
    steps: ['Vous importez vos supports', 'Exama crée un examen', 'Vous répondez', 'Vous êtes corrigé'],
    details: [
      { title: 'Deux types de questions', text: 'QCM et questions à réponse courte. Vous choisissez la longueur de l’examen.', icon: 'exam' },
      { title: 'Corrigé et commenté', text: 'Les QCM sont corrigés instantanément. Les réponses courtes sont évaluées par rapport à vos supports, avec un commentaire pour chacune.', icon: 'graded' },
      { title: 'Consultez la source', text: 'Chaque résultat indique le passage de vos supports à partir duquel la question a été rédigée.', icon: 'quote' },
      { title: 'Dans votre langue', text: 'Révisez en français, anglais, espagnol ou arabe, quelle que soit la langue de vos supports.', icon: 'globe' },
    ],
  },
  weak: {
    eyebrow: 'Points faibles et entraînement ciblé',
    title: 'Repérez ce que vous ne maîtrisez pas encore — et corrigez-le',
    lead: 'Chaque réponse corrigée met à jour votre niveau sur ce thème. Exama signale vos points faibles et vous entraîne dessus, avec des examens de suivi centrés sur les thèmes et les erreurs à retravailler.',
    loopAria: 'Le cycle de révision',
    steps: ['Révisez', 'Testez-vous', 'Repérez vos points faibles', 'Entraînez-vous', 'Progressez'],
    back: 'et on recommence',
    fineTrial: 'L’analyse des points faibles et l’entraînement adaptatif font partie de Student et Pro, y compris pendant leur essai gratuit. Avec Free et Basic, vous vous entraînez sur tous les thèmes de votre cours.',
    fineFree: 'L’analyse des points faibles et l’entraînement adaptatif font partie de Student et Pro. Avec Free et Basic, vous vous entraînez sur tous les thèmes de votre cours.',
  },
  plan: {
    eyebrow: 'Plan de révision personnalisé',
    title: 'Un plan de révision qui connaît la date de votre examen',
    lead: 'Indiquez à Exama la date de votre examen, le nombre de minutes que vous pouvez y consacrer chaque jour et votre niveau de préparation. Il planifie chaque jour jusqu’à l’examen à partir de vos supports et de vos résultats.',
    inputsTitle: 'Ce qui nourrit votre plan',
    inputs: [
      { title: 'Vos supports de cours', text: 'Les thèmes abordés par votre cours et leur importance.', icon: 'folder' },
      { title: 'Vos résultats', text: 'Les thèmes que vous maîtrisez et ceux qui vous résistent.', icon: 'chart' },
      { title: 'Votre emploi du temps', text: 'La date de votre examen, vos minutes par jour et vos jours de révision.', icon: 'clock' },
    ],
    outputsTitle: 'Ce que vous obtenez',
    outputs: [
      'Un plan pour chaque jour jusqu’à votre examen.',
      'Apprendre, s’entraîner, réviser, puis une révision finale — plus de temps pour les thèmes plus faibles et plus importants.',
      'Il se réorganise quand vous terminez, sautez ou manquez une tâche.',
      'Les tâches du jour et votre progression, au même endroit.',
    ],
    fineTrial: 'Le plan qui s’adapte à vos résultats fait partie de Student et Pro, y compris pendant leur essai gratuit. Free et Basic comprennent un planificateur qui répartit vos thèmes de manière égale.',
    fineFree: 'Le plan qui s’adapte à vos résultats fait partie de Student et Pro. Free et Basic comprennent un planificateur qui répartit vos thèmes de manière égale.',
  },
  product: {
    eyebrow: 'Dans Exama',
    title: 'Tout ce qu’il vous faut, dans une seule app',
    lead: 'Vos supports, vos examens, vos résultats, vos points faibles et votre plan de révision — tout est construit à partir du même cours.',
    areas: [
      { id: 'materials', title: 'Supports de cours', text: 'Tous les PDF, diaporamas et cours enregistrés d’un cours au même endroit, avec les thèmes de chacun.', icon: 'folder', alt: 'L’écran des supports de cours dans Exama' },
      { id: 'exams', title: 'Examens', text: 'Générez un examen à partir d’un cours, répondez aux questions et envoyez.', icon: 'exam', alt: 'Un examen dans Exama' },
      { id: 'results', title: 'Résultats', text: 'Votre note, un commentaire sur chaque réponse et le passage source.', icon: 'graded', alt: 'L’écran des résultats dans Exama' },
      { id: 'weak-topics', title: 'Points faibles', text: 'Votre progression thème par thème, avec vos points faibles signalés.', icon: 'target', alt: 'L’écran des points faibles dans Exama' },
      { id: 'planner', title: 'Planificateur de révision', text: 'Les tâches du jour et votre plan jusqu’au jour de l’examen.', icon: 'calendar', alt: 'Le planificateur de révision dans Exama' },
    ],
  },
  pricing: {
    eyebrow: 'Tarifs',
    titleTrial: (days) => `Commencez avec ${days} jours gratuits`,
    titleFree: 'Commencez gratuitement, passez à une offre supérieure quand vous en avez besoin',
    leadTrial: (days) => `Essayez gratuitement l’offre de votre choix pendant ${days} jours, avec un accès complet à tout ce qu’elle comprend. Aucun paiement aujourd’hui, et vous pouvez résilier à tout moment avant la fin de l’essai.`,
    leadFree: 'Utilisez Exama avec l’offre Free, gratuitement et sans carte. Les offres payantes ajoutent davantage de cours, les cours enregistrés et l’entraînement adaptatif.',
    recommended: 'Recommandé',
    perMonth: '/mois',
    orYearly: (yearly, pct) => `ou ${yearly}/an · ${pct} % d’économie`,
    zero: '0 €',
    noPayment: 'Aucun paiement',
    plans: {
      free: {
        name: 'Free',
        tagline: 'Essayez Exama sur un cours.',
        features: [{ text: 'PDF et PowerPoint (.pptx)' }, { text: 'Examens, entraînement et planificateur de révision' }, { text: '1 cours à la fois' }, { text: '1 cours audio ou vidéo par compte' }],
      },
      basic: {
        name: 'Basic',
        tagline: 'PDF et PowerPoint.',
        features: [{ text: 'PDF et PowerPoint (.pptx)' }, { text: 'Examens, entraînement et planificateur de révision' }, { text: 'Jusqu’à 3 cours à la fois' }, { text: 'Pas de cours audio ni vidéo', off: true }],
      },
      student: {
        name: 'Student',
        tagline: 'Tous vos supports, un apprentissage personnalisé.',
        features: [
          { text: 'Tout ce qu’offre Basic' },
          { text: 'Cours audio et vidéo' },
          { text: 'Analyse des points faibles et entraînement adaptatif' },
          { text: 'Plan de révision qui s’adapte à vos résultats' },
          { text: 'Jusqu’à 15 cours à la fois' },
        ],
      },
      pro: {
        name: 'Pro',
        tagline: 'Utilisation maximale de l’IA.',
        features: [{ text: 'Tout ce qu’offre Student, avec des quotas bien plus élevés' }, { text: 'Jusqu’à 50 cours à la fois' }, { text: 'Le quota d’utilisation de l’IA le plus élevé' }],
      },
    },
    fineTrial: (days) =>
      `Les prix sont des prix catalogue en euros. Sur le web, vous payez par carte via Stripe et gérez ou résiliez à tout moment depuis Compte → Gérer la facturation. Vous indiquez un moyen de paiement lors de la commande, mais rien n’est prélevé aujourd’hui : à la fin de l’essai de ${days} jours, l’offre choisie commence, sauf si vous résiliez avant. Si vous vous abonnez plutôt dans une app mobile, l’App Store ou Google Play vous facture et affiche le prix de votre pays. Un abonnement souscrit à un endroit débloque votre compte partout.`,
    fineFree: 'Les prix sont des prix catalogue en euros. L’écran des offres de l’app Exama indique les offres que vous pouvez choisir pour votre compte et leur mode de facturation. Un abonnement souscrit à un endroit débloque votre compte partout.',
  },
  faq: {
    eyebrow: 'FAQ',
    title: 'Questions fréquentes',
    items: (trial, days) => [
      {
        q: 'Que puis-je importer dans Exama ?',
        a: [
          'Des PDF, des présentations PowerPoint (.pptx), des enregistrements audio (MP3, M4A, WAV) et des vidéos (MP4, MOV). Vous pouvez les combiner dans un même cours : tout ce que vous ajoutez alimente les mêmes examens, le même entraînement et le même plan de révision.',
          trial
            ? 'Les cours audio et vidéo sont inclus dans Student et Pro, y compris pendant leur essai gratuit. Free comprend un cours enregistré par compte ; Basic couvre les PDF et PowerPoint.'
            : 'Les cours audio et vidéo sont inclus dans Student et Pro. Free comprend un cours enregistré par compte ; Basic couvre les PDF et PowerPoint.',
        ],
      },
      {
        q: 'Comment Exama crée-t-il mes examens ?',
        a: [
          'Exama lit d’abord vos supports et repère les thèmes qu’ils enseignent. Quand vous demandez un examen, il rédige des QCM et des questions à réponse courte sur ces thèmes à partir de votre contenu. Vous choisissez la longueur, répondez aux questions et envoyez pour être corrigé.',
        ],
      },
      {
        q: 'Les questions sont-elles basées sur mes supports de cours ?',
        a: [
          'Oui. Les questions sont rédigées à partir de vos propres supports, et chacune doit s’appuyer sur un passage de ceux-ci : une question qui ne peut pas y être rattachée est écartée. Vos résultats indiquent le passage pour que vous puissiez le vérifier.',
          'Exama est une IA et peut tout de même se tromper : vérifiez les informations importantes dans votre cours.',
        ],
      },
      {
        q: 'Exama comprend-il les cours enregistrés ?',
        a: [
          'Oui. Les cours audio et vidéo sont transcrits et analysés comme n’importe quel autre support, et leurs thèmes rejoignent votre cours. Exama travaille à partir de ce qui est dit : les diapositives ou schémas montrés à l’écran sans être commentés ne sont pas pris en compte.',
          trial
            ? 'Les cours enregistrés font partie de Student et Pro, y compris pendant leur essai gratuit ; Free comprend un cours enregistré par compte, dont il utilise les 45 premières minutes.'
            : 'Les cours enregistrés font partie de Student et Pro ; Free comprend un cours enregistré par compte, dont il utilise les 45 premières minutes.',
        ],
      },
      ...(trial
        ? [
            {
              q: `Comment fonctionne l’essai gratuit de ${days} jours ?`,
              a: [
                `Chaque compte peut démarrer un essai gratuit de ${days} jours. Créez votre compte Exama sur app.exama.app, choisissez Basic, Student ou Pro et démarrez l’essai lors de la commande. Pendant l’essai, vous avez un accès complet à l’offre choisie, avec tout ce qu’elle comprend.`,
                `Vous indiquez un moyen de paiement lors de la commande (géré par Stripe), mais rien n’est prélevé aujourd’hui. Si vous ne faites rien, l’offre choisie démarre automatiquement à la fin des ${days} jours. Résiliez à tout moment avant depuis Compte → Gérer la facturation et vous ne serez pas débité.`,
                'Vous avez déjà un compte ? Connectez-vous et choisissez votre offre : l’essai vous est proposé si votre compte ne l’a pas encore utilisé. L’essai fonctionne dans n’importe quel navigateur. Un abonnement souscrit dans une app mobile, là où c’est possible, est facturé par l’App Store ou Google Play et débloque le même compte.',
              ],
            },
            {
              q: 'Que se passe-t-il après l’essai ?',
              a: [
                `À la fin des ${days} jours, l’offre choisie commence et son prix est prélevé sur votre carte, sauf si vous résiliez avant la fin de l’essai. Si vous résiliez pendant l’essai, vous passez à l’offre Free dès que la résiliation est confirmée et conservez vos cours et votre progression.`,
                'Ensuite, vous pouvez résilier ou changer d’offre à tout moment depuis Compte → Gérer la facturation ; une offre résiliée reste active jusqu’à la fin de la période payée.',
              ],
            },
          ]
        : [
            {
              q: 'Puis-je utiliser Exama gratuitement ?',
              a: [
                'Oui. L’offre Free ne coûte rien et ne nécessite pas de carte : un cours à la fois, PDF et PowerPoint, examens, entraînement et planificateur de révision, et un cours audio ou vidéo par compte.',
                'Créez votre compte sur app.exama.app, ou connectez-vous si vous en avez déjà un.',
              ],
            },
            {
              q: 'Comment choisir une offre payante ?',
              a: [
                'Connectez-vous à l’app Exama et ouvrez l’écran des offres (depuis Compte ou depuis n’importe quel bouton pour passer à une offre supérieure). Il indique les offres que vous pouvez choisir pour votre compte, leur prix et leur mode de facturation. Vos cours et votre progression restent sur votre compte, quelle que soit votre offre.',
              ],
            },
          ]),
      {
        q: 'Exama ne fonctionne-t-il qu’avec des PDF ?',
        a: ['Non. Les PDF ne sont qu’une option. Exama fonctionne aussi avec les présentations PowerPoint, les enregistrements audio et les vidéos — le tout dans le même cours.'],
      },
    ],
  },
  final: {
    title: 'Mettez vos supports de cours au travail.',
    text: 'Importez-les une fois. Obtenez examens, corrections, entraînement sur vos points faibles et plan de révision construits à partir d’eux.',
    noteTrial: (days) => `${days} jours gratuits · Carte demandée, aucun paiement aujourd’hui · Résiliable à tout moment avant la fin`,
    noteFree: 'Offre gratuite · Sans carte · Déjà un compte ? Connectez-vous',
  },
  footer: {
    tagline: 'Votre coach d’examen IA, construit à partir de vos propres supports de cours.',
    openApp: 'Ouvrir l’app Exama',
    product: 'Produit',
    legalHelp: 'Mentions et aide',
    account: 'Compte',
    links: { how: 'Fonctionnement', materials: 'Supports compatibles', pricing: 'Tarifs', faq: 'FAQ', privacy: 'Confidentialité', terms: 'Conditions', support: 'Aide', login: 'Se connecter', signup: 'Créer un compte' },
  },
  support: {
    title: 'Aide',
    description: 'Obtenir de l’aide pour Exama.',
    intro: 'Des questions, un problème ou une suggestion ? Dans l’app Exama, ouvrez Compte → Aide et assistance pour trouver les réponses aux questions fréquentes et nous contacter.',
    openApp: 'Ouvrir l’app Exama',
    emailLead: 'Vous pouvez aussi nous écrire à',
    noEmail: 'Une adresse e-mail d’assistance sera indiquée ici avant le lancement.',
    faqLead: 'Vous cherchez une réponse sur l’import, les examens ou les offres ?',
    faqLink: 'Consultez les questions fréquentes',
    back: '← Retour à exama.app',
  },
};
