import { signOut } from "@/lib/auth/actions";
import { buttonClassName } from "@/components/ui/button";

/** Server-action form; works without client JS. */
export function SignOutButton() {
  return (
    <form action={signOut}>
      <button type="submit" className={buttonClassName("ghost")}>
        Sign out
      </button>
    </form>
  );
}
