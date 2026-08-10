/**
 * Static, curated knowledge used by the smart search bar.
 *
 * Suggestions are drawn from this taxonomy, the user's own expertise, and real
 * job data from the feed. The system never fabricates skills that the user does
 * not have.
 */

export interface RoleVariation {
  /** Display label, e.g. "React + Next.js Developer". */
  role: string;
  /** Broad category, e.g. "Web Development". */
  category: string;
  /** Lowercase tokens used to match user input and job text. */
  keywords: string[];
}

export const ROLE_TAXONOMY: RoleVariation[] = [
  { category: 'Web Development', role: 'React Developer', keywords: ['react'] },
  { category: 'Web Development', role: 'React Native Developer', keywords: ['react native', 'react'] },
  { category: 'Web Development', role: 'React + Next.js Developer', keywords: ['react', 'next.js', 'nextjs'] },
  { category: 'Web Development', role: 'Senior React Developer', keywords: ['react', 'senior'] },
  { category: 'Web Development', role: 'React Frontend Engineer', keywords: ['react', 'frontend'] },
  { category: 'Web Development', role: 'Frontend Developer', keywords: ['frontend', 'front end'] },
  { category: 'Web Development', role: 'Backend Developer', keywords: ['backend', 'back end'] },
  { category: 'Web Development', role: 'Full Stack Developer', keywords: ['full stack', 'fullstack'] },
  { category: 'Web Development', role: 'MERN Stack Developer', keywords: ['mern', 'full stack', 'mongodb'] },
  { category: 'Web Development', role: 'Python Developer', keywords: ['python'] },
  { category: 'Web Development', role: 'Python Django Developer', keywords: ['python', 'django'] },
  { category: 'Web Development', role: 'Node.js Developer', keywords: ['node', 'node.js', 'nodejs'] },
  { category: 'Web Development', role: 'TypeScript Developer', keywords: ['typescript', 'ts'] },
  { category: 'Web Development', role: 'Vue Developer', keywords: ['vue'] },
  { category: 'Web Development', role: 'Angular Developer', keywords: ['angular'] },
  { category: 'Web Development', role: 'WordPress Developer', keywords: ['wordpress', 'wp'] },
  { category: 'Web Development', role: 'WooCommerce Developer', keywords: ['woocommerce', 'wordpress'] },
  { category: 'Web Development', role: 'Shopify Developer', keywords: ['shopify'] },
  { category: 'Web Development', role: 'E-Commerce Developer', keywords: ['ecommerce', 'e-commerce', 'shopify', 'woocommerce'] },
  { category: 'Web Development', role: 'API Developer', keywords: ['api', 'rest', 'graphql'] },

  { category: 'Mobile Apps', role: 'Mobile App Developer', keywords: ['mobile', 'app'] },
  { category: 'Mobile Apps', role: 'Flutter Developer', keywords: ['flutter'] },
  { category: 'Mobile Apps', role: 'React Native Developer', keywords: ['react native'] },
  { category: 'Mobile Apps', role: 'iOS Developer', keywords: ['ios', 'swift'] },
  { category: 'Mobile Apps', role: 'Android Developer', keywords: ['android', 'kotlin'] },

  { category: 'AI / Machine Learning', role: 'AI/ML Developer', keywords: ['ai', 'machine learning', 'ml'] },
  { category: 'AI / Machine Learning', role: 'ChatGPT Integration Developer', keywords: ['chatgpt', 'gpt', 'openai', 'ai'] },
  { category: 'AI / Machine Learning', role: 'LangChain / LLM Developer', keywords: ['langchain', 'llm', 'ai', 'gpt'] },
  { category: 'AI / Machine Learning', role: 'Machine Learning Engineer', keywords: ['machine learning', 'ml'] },
  { category: 'AI / Machine Learning', role: 'AI Chatbot Developer', keywords: ['chatbot', 'ai', 'bot'] },
  { category: 'AI / Machine Learning', role: 'Data Scientist', keywords: ['data science', 'ml', 'python'] },

  { category: 'Data & Analytics', role: 'Data Analyst', keywords: ['data analyst', 'analyst'] },
  { category: 'Data & Analytics', role: 'SQL / PostgreSQL Developer', keywords: ['sql', 'postgresql', 'database'] },
  { category: 'Data & Analytics', role: 'Power BI Developer', keywords: ['power bi', 'bi'] },
  { category: 'Data & Analytics', role: 'Data Engineer', keywords: ['data engineer', 'etl'] },
  { category: 'Data & Analytics', role: 'Web Scraper / Automation Developer', keywords: ['scraping', 'scraper', 'automation', 'selenium', 'playwright'] },

  { category: 'DevOps / Cloud', role: 'DevOps Engineer', keywords: ['devops'] },
  { category: 'DevOps / Cloud', role: 'AWS Cloud Engineer', keywords: ['aws', 'cloud'] },
  { category: 'DevOps / Cloud', role: 'Kubernetes Specialist', keywords: ['kubernetes', 'k8s'] },
  { category: 'DevOps / Cloud', role: 'CI/CD Automation Engineer', keywords: ['ci/cd', 'ci', 'cd', 'devops'] },

  { category: 'Design / UI-UX', role: 'UI/UX Designer', keywords: ['ui/ux', 'ui', 'ux'] },
  { category: 'Design / UI-UX', role: 'Figma Designer', keywords: ['figma'] },
  { category: 'Design / UI-UX', role: 'Web Designer', keywords: ['web design', 'design'] },
  { category: 'Design / UI-UX', role: 'Product Designer', keywords: ['product design', 'design'] },

  { category: 'Project Management', role: 'Project Manager', keywords: ['project manager', 'pm'] },
  { category: 'Project Management', role: 'Technical Project Manager', keywords: ['technical', 'project manager'] },
  { category: 'Project Management', role: 'IT Project Manager', keywords: ['it', 'project manager'] },
  { category: 'Project Management', role: 'Agile Project Manager', keywords: ['agile', 'scrum', 'project manager'] },
  { category: 'Project Management', role: 'Project Manager + SaaS', keywords: ['saas', 'project manager'] },

  { category: 'Marketing / Growth', role: 'Growth Marketing Manager', keywords: ['growth marketing', 'growth'] },
  { category: 'Marketing / Growth', role: 'Performance Marketing Manager', keywords: ['performance marketing', 'performance'] },
  { category: 'Marketing / Growth', role: 'Paid Media Specialist', keywords: ['paid media', 'ads', 'facebook ads', 'google ads'] },
  { category: 'Marketing / Growth', role: 'E-Commerce Growth Manager', keywords: ['ecommerce growth', 'e-commerce growth', 'growth'] },
  { category: 'Marketing / Growth', role: 'Telehealth Growth Manager', keywords: ['telehealth', 'healthcare', 'growth'] },
  { category: 'Marketing / Growth', role: 'Marketing Strategy Consultant', keywords: ['marketing strategy', 'strategy', 'marketing'] },
  { category: 'Marketing / Growth', role: 'SEO Specialist', keywords: ['seo'] },
  { category: 'Marketing / Growth', role: 'Content Marketing Manager', keywords: ['content marketing', 'marketing'] },

  { category: 'Content & Writing', role: 'Content Writer', keywords: ['content writer', 'writer'] },
  { category: 'Content & Writing', role: 'Technical Writer', keywords: ['technical writer'] },
  { category: 'Content & Writing', role: 'Copywriter', keywords: ['copywriting', 'copywriter'] },
  { category: 'Content & Writing', role: 'SEO Content Writer', keywords: ['seo', 'content'] },
  { category: 'Content & Writing', role: 'Blog Writer', keywords: ['blog', 'writing', 'writer'] },
];

/** Short-form → canonical form. Order matters (longest first). */
export const ALIASES: Record<string, string> = {
  reactjs: 'react',
  nextjs: 'next.js',
  nodejs: 'node.js',
  fullstack: 'full stack',
  'full-stack': 'full stack',
  'front-end': 'frontend',
  'back-end': 'backend',
  uiux: 'ui/ux',
  'ui ux': 'ui/ux',
  dev: 'developer',
  devs: 'developer',
  engineer: 'engineer',
  eng: 'engineer',
  pm: 'project manager',
  saas: 'saas',
  ml: 'machine learning',
  js: 'javascript',
  ts: 'typescript',
  ecom: 'ecommerce',
  ecomm: 'ecommerce',
  wordpress: 'wordpress',
  k8s: 'kubernetes',
};

/** Role marker words used to rebuild "Skill + Role" and "Domain + Role" phrases. */
export const ROLE_MARKERS = [
  'developer', 'engineer', 'designer', 'manager', 'writer', 'consultant',
  'specialist', 'analyst', 'architect', 'administrator', 'scientist',
];

/** Words that are too generic on their own to produce a useful search. */
export const VAGUE_TERMS = [
  'developer', 'engineer', 'designer', 'writer', 'manager', 'marketing',
  'consultant', 'specialist', 'assistant', 'analyst', 'expert', 'dev',
  'it', 'saas', 'software', 'website', 'web', 'app', 'mobile', 'data',
  'development', 'design', 'content', 'project', 'technology',
];

/** Brand / acronym display overrides used when title-casing a query. */
const SPECIAL_DISPLAY: Record<string, string> = {
  saas: 'SaaS', ai: 'AI', ml: 'ML', api: 'API', seo: 'SEO', it: 'IT',
  ci: 'CI', cd: 'CD', gpt: 'GPT', ui: 'UI', ux: 'UX', css: 'CSS', html: 'HTML',
  aws: 'AWS', sql: 'SQL', php: 'PHP', ios: 'iOS', bi: 'BI', k8s: 'K8s',
  mern: 'MERN', 'ui/ux': 'UI/UX', next: 'Next.js', node: 'Node.js', nextjs: 'Next.js',
  nodejs: 'Node.js',
};

/** Title-case a normalized phrase, preserving brand/acronym casing. */
export function titleCase(phrase: string): string {
  return phrase
    .split(' ')
    .map((word) => {
      const lower = word.toLowerCase();
      if (SPECIAL_DISPLAY[lower]) return SPECIAL_DISPLAY[lower];
      if (lower === 'react') return 'React';
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}
