"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: String(data.get("email")),
          password: String(data.get("password")),
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.errorMessage ?? "Could not sign in.");
      router.replace(next);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not sign in.");
    } finally {
      setPending(false);
    }
  }
  return (
    <form className="paper-card grid gap-5" onSubmit={submit}>
      <label className="grid gap-2">
        Email
        <input
          className="paper-input"
          name="email"
          type="email"
          autoComplete="username"
          required
          maxLength={254}
        />
      </label>
      <label className="grid gap-2">
        Password
        <input
          className="paper-input"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={256}
        />
      </label>
      {message && (
        <p role="alert" className="text-sm">
          {message}
        </p>
      )}
      <button
        type="submit"
        className="paper-btn paper-btn-solid"
        disabled={pending}
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
