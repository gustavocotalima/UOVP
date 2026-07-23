import { redirect } from "next/navigation";
import { auth } from "@/auth";

export default async function IndexPage() {
  redirect((await auth())?.user ? "/home" : "/login");
}
