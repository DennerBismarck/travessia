import { Console } from "@/components/Console";
import { Header } from "@/components/Header";
import { NotProven } from "@/components/NotProven";
import { SiteFooter } from "@/components/SiteFooter";

export default function Home() {
  return (
    <main className="page">
      <Header />
      <Console />
      <NotProven />
      <SiteFooter />
    </main>
  );
}
