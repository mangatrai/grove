import { type FormEvent, useState } from "react";
import { Alert, Anchor, Button, Paper, PasswordInput, Stack, Text, Title } from "@mantine/core";
import { useNavigate, useSearchParams } from "react-router-dom";

const PASSWORD_HINT =
  "Use at least 12 characters with uppercase, lowercase, number, and special character.";

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const navigate = useNavigate();

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [genericError, setGenericError] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState(false);
  const [samePasswordError, setSamePasswordError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  if (!token) {
    return (
      <Paper withBorder shadow="sm" radius="md" p="lg" maw={520} mx="auto" mt="xl">
        <Stack gap="sm">
          <Title order={3}>Reset password</Title>
          <Alert color="red" variant="light">Invalid or expired link.</Alert>
          <Anchor href="/#/">Back to sign in</Anchor>
        </Stack>
      </Paper>
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setGenericError(null);
    setTokenError(false);
    setSamePasswordError(null);
    setConfirmError(null);
    if (newPassword !== confirmPassword) {
      setConfirmError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword })
      });

      if (res.ok) {
        navigate("/?reset=1", { replace: true });
        return;
      }

      if (res.status === 400) {
        const body = (await res.json()) as { code?: string };
        if (body.code === "INVALID_TOKEN") {
          setTokenError(true);
          return;
        }
        if (body.code === "SAME_AS_CURRENT") {
          setSamePasswordError("New password must be different from your current password.");
          return;
        }
      }

      setGenericError("Could not reset password. Please try again.");
    } catch {
      setGenericError("Could not reset password. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Paper withBorder shadow="sm" radius="md" p="lg" maw={520} mx="auto" mt="xl">
      <Stack gap="md">
        <Title order={3}>Reset password</Title>
        {tokenError ? (
          <Alert color="red" variant="light">
            This link has expired or was already used. Request a new one.{" "}
            <Anchor href="/#/">Back to sign in</Anchor>
          </Alert>
        ) : null}
        {genericError ? (
          <Alert color="red" variant="light">{genericError}</Alert>
        ) : null}
        <form onSubmit={onSubmit}>
          <Stack gap="sm">
            <PasswordInput
              label="New password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.currentTarget.value)}
              required
              error={samePasswordError ?? undefined}
            />
            <Text size="xs" c="dimmed">{PASSWORD_HINT}</Text>
            <PasswordInput
              label="Confirm password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.currentTarget.value)}
              required
              error={confirmError ?? undefined}
            />
            <Button type="submit" color="green" loading={loading}>Update password</Button>
          </Stack>
        </form>
      </Stack>
    </Paper>
  );
}
