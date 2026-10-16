import { Console } from "@/components/Console";
import { Header } from "@/components/Header";
import { SiteFooter } from "@/components/SiteFooter";

export default function Home() {
  return (
    <main className="page">
      <Header />
      <Console />
      <SiteFooter />
    </main>
  );
}
