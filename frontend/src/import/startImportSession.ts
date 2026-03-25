import { apiJson } from "../api";

/** Creates a new upload import session and returns its id. */
export async function startImportSession(): Promise<string> {
  const data = await apiJson<{ session: { id: string } }>("/imports/sessions", {
    method: "POST",
    body: JSON.stringify({ sourceType: "upload" })
  });
  return data.session.id;
}
