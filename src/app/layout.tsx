import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";
import "./globals.css";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PulsoShell } from "@/components/pulso/shell";
import branding from "../../branding.json";

export const metadata: Metadata = {
  title: "Hoy · Pulso",
  description: "Demo ficticia de Esteban para crear hábitos personales, marcar cada día y revisar la semana.",
  icons: { icon: "/icon.svg", apple: "/apple-icon.png" },
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const api = process.env.NEXT_PUBLIC_CONSTRUCTOR_API?.replace(/\/+$/, "");
  const project = process.env.NEXT_PUBLIC_PROJECT_ID;
  const collector = api && project
    ? `${api}/v1/projects/${project}/analytics/script.js`
    : undefined;
  return <html lang="es" className="h-full antialiased" style={{
    "--brand-font-heading": branding.fontHeading,
    "--brand-font-body": branding.fontBody,
  } as CSSProperties}>
    <body className="min-h-full">
      <TooltipProvider><PulsoShell>{children}</PulsoShell></TooltipProvider>
      {collector && <script src={"https://constructor-api-git-dev-useconstructor.vercel.app/v1/projects/P-DU29J8/analytics/script.js"} defer></script>}
      <script src="/constructor-editor.js" defer></script>
    </body>
  </html>;
}
