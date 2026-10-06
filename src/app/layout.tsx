import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

const title = "ResumeRAG — Interview prep grounded in your own documents";
const description =
  "Upload your resume, project reports and job descriptions. ResumeRAG builds a private knowledge base in your browser and prepares you for interviews with answers you can trace back to your own documents.";

export const metadata: Metadata = {
  title: {
    default: title,
    template: "%s · ResumeRAG",
  },
  description,
  applicationName: "ResumeRAG",
  authors: [{ name: "Gundeep Singh", url: "https://github.com/gundeeps247" }],
  // Link previews. The image is src/app/opengraph-image.tsx; Next.js resolves its URL against the
  // deployment's own domain, so no site URL is hard-coded here.
  openGraph: { type: "website", siteName: "ResumeRAG", title, description, locale: "en_US" },
  twitter: { card: "summary_large_image", title, description },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafb" },
    { media: "(prefers-color-scheme: dark)", color: "#16171c" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
      <body className="bg-background min-h-dvh font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
