import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col justify-center gap-4 px-4 py-16">
      <h1 className="text-3xl font-semibold">RRHH · APS Holding</h1>
      <p className="opacity-70">Plataforma de gestión de personas.</p>
      <nav>
        <Link href="/empresas" className="underline underline-offset-4">
          Ver empresas →
        </Link>
      </nav>
    </main>
  );
}
