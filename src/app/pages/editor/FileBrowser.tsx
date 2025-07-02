import { getSiblingFiles } from "./functions";

export async function FileBrowser({ pathname }: { pathname: string }) {
  const files = await getSiblingFiles(pathname);
  return (
    <div className="h-full overflow-y-auto">
      <h2 className="font-bold border-b-4">Files</h2>
      {files && files.length > 0 ? (
        <ul>
          {files.map((file) => (
            <li key={file.path}>
              <a href={file.path}>
                {file.type === "directory" ? "📁" : "📄"} {file.name}
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p>No files found.</p>
      )}
    </div>
  );
}
