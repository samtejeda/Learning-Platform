import { signOut } from "@/lib/auth/actions";
import { buttonClassName } from "@/components/ui/button";

/** Server-action form; works without client JS. */
export function SignOutButton() {
  return (
    <form action={signOut} className="w-full md:w-auto">
      <button type="submit" className={buttonClassName("secondary", true, "sm", "md:w-auto")}>
        Sign out
      </button>
    </form>
  );
}
