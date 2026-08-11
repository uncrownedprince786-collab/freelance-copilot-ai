import type { Metadata } from "next";
import "./globals.css";
import AgentPanel from "@/components/AgentPanel";

export const metadata: Metadata = {
  title: "Lead Hunter | Freelance Opportunity Monitor",
  description: "Live freelance opportunities from Upwork and Freelancer with transparent scoring and real budget figures.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var s=localStorage.getItem('lh_theme');if(s!=='light'&&s!=='dark'){s=(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light';}document.documentElement.setAttribute('data-theme',s);}catch(e){document.documentElement.setAttribute('data-theme','light');}})();`,
          }}
        />
      </head>
      <body>
        {children}
        <AgentPanel />
      </body>
    </html>
  );
}