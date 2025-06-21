import { requestInfo } from "rwsdk/worker";
import { Editor } from "./Editor";
import { FileBrowser } from "./FileBrowser";
import { fileType, getFile } from "./functions";

export const EditorPage = async () => {
  // we need to determine if this is a folder or a filename.

  const url = new URL(requestInfo.request.url);
  let pathname = url.pathname;
  if (url.pathname.startsWith("/editor")) {
    pathname = pathname.split("/editor")[1];
  }

  const type = await fileType(pathname);
  let content = "";
  if (type == "file") {
    const file = await getFile(pathname);
    content = file.file;
  }

  return (
    <div className="h-full">
      <div className="flex h-full">
        <div className="h-full resize-x min-w-[180px] overflow-auto border-r p-2">
          <FileBrowser type={type} />
        </div>
        <div className="h-full min-w-[600px] resize-x border-r overflow-auto">
          <Editor path={pathname} initialContent={content} />
        </div>
        <div className="h-full">
          <iframe src="http://localhost:5174/" className="h-full" />
        </div>
      </div>
    </div>
  );
};
