import { redirect } from "next/navigation";

/** `/` is handled by next-intl middleware (locale prefix); land on the dashboard. */
export default function RootPage() {
  redirect("/en/dashboard");
}
