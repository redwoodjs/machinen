import { FileItem, getFiles } from "./functions";

import { requestInfo } from "rwsdk/worker";

export async function FileBrowser({ type }: { type: "file" | "directory" }) {
  // what we need is the request, and based off that we'll determine the url.

  const url = new URL(requestInfo.request.url);
  let pathname = url.pathname;

  if (url.pathname.startsWith("/editor")) {
    pathname = pathname.split("/editor")[1];
  }

  if (type == "file") {
    pathname = pathname.split("/").slice(0, -1).join("/");
  }

  if (pathname == "") {
    pathname = "/";
  }

  // let's normalize this, so we remove everything after "`editor/`"
  // const relativeUrl = url.split("/editor")[1] || "/";
  const files = await getFiles(pathname);

  // console.log("files", files);
  // const [files, setFiles] = useState<FileItem[] | undefined>(undefined);
  // const [currentPath, setCurrentPath] = useState<string>("/");

  // useEffect(() => {
  //   const fetchFiles = async () => {
  //     const files = await getFiles();
  //     setFiles(files);
  //   };
  //   fetchFiles();
  // }, []);

  return (
    <div className="h-full overflow-y-auto">
      {/* We need to allow the user to go back if the current path is a sub-folder */}

      {files && files.length > 0 ? (
        <ul className="h-full">
          {files.map((file) => (
            <li
              key={file.path}
              // onClick={() => handleFileClick(file)}
              style={{ cursor: "pointer" }}
            >
              <a href={"/editor" + file.path + file.name}>
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
