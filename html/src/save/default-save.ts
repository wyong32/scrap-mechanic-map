export async function loadBundledSave(
  url: string,
  fileName: string
): Promise<File> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Unable to load bundled save (${response.status})`);
  }
  return new File([await response.arrayBuffer()], fileName, {
    type: "application/vnd.sqlite3"
  });
}
