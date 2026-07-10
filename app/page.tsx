import { redirect } from "next/navigation";

/** The catalog is the home of the console. */
export default function Home() {
  redirect("/catalog");
}
