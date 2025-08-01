import {
  Toolbar,
  ToolbarContent,
  ToolbarGroup,
  ToolbarItem,
  Button,
  Tooltip,
  Skeleton,
} from "@patternfly/react-core";
import { BellIcon, DownloadIcon, ExpandIcon } from "@patternfly/react-icons";
import { LogViewer, LogViewerSearch } from "@patternfly/react-log-viewer";
import { API_URL } from "@utils/constants";
import { FC, useEffect, useState, useRef } from "react";
import "./PipelineLog.css";
import { useNotification } from "@appContext/AppNotificationContext";
import { fetchFile } from "src/apis/apis";
import { useTranslation } from "react-i18next";

// Extend the Document interface
interface ExtendedDocument extends Document {
  mozFullScreenElement?: Element | null;
  webkitFullscreenElement?: Element | null;
  msFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void>;
  msExitFullscreen?: () => void;
}

// Extend the HTMLElement interface
interface ExtendedHTMLElement extends HTMLElement {
  mozRequestFullScreen?: () => Promise<void>;
  webkitRequestFullScreen?: (keyboardInput?: number) => Promise<void>;
  msRequestFullscreen?: () => Promise<void>;
}

interface PipelineLogProps {
  activeTabKey: string;
  pipelineId: string | undefined;
  pipelineName: string;
}

// Maximum number of log lines to keep in memory
const MAX_LOG_LINES = 1000;


const PipelineLog: FC<PipelineLogProps> = ({
  activeTabKey,
  pipelineId,
  pipelineName,
}) => {
  const { addNotification } = useNotification();
  const { t } = useTranslation();

  const [logs, setLogs] = useState<string[]>([]);
  // Set to track unique logs
  const logSet = useRef(new Set<string>());

  const [isLogDownloading, setIsLogDownloading] = useState<boolean>(false);
  const [isWebSocketLoading, setIsWebSocketLoading] = useState<boolean>(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const [logSearchText, setLogSearchText] = useState<string>("");
  const [notificationLogToggle, setNotificationLogToggle] = useState(false);

  // Close WebSocket connection when tab is not active
  useEffect(() => {
    const isActive = activeTabKey === "logs";
    if (!isActive && wsRef.current) {
      console.log("Closing WebSocket connection as log tab is not active");
      wsRef.current.close();
      wsRef.current = null;
    }

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }   
    };
  }, [activeTabKey]);

  useEffect(() => {
    if (activeTabKey !== "logs") return;
    setIsWebSocketLoading(true);

    // Only fetch logs when tab is active
    // Fetch initial logs via HTTP
    fetch(`${API_URL}/api/pipelines/${pipelineId}/logs`)
      .then((response) => response.text())
      .then((initialLogs) => {
        const initialLogLines = initialLogs.split("\n");

        // Reset logs when tab becomes active
        logSet.current.clear();

        // Add initial logs to the set and state
        const uniqueInitialLogs = initialLogLines.filter(logLine => {
          if (logLine && !logSet.current.has(logLine)) {
            logSet.current.add(logLine);
            return true;
          }
          return false;
        });

        // Apply log rotation if needed
        if (uniqueInitialLogs.length > MAX_LOG_LINES) {
          uniqueInitialLogs.splice(0, uniqueInitialLogs.length - MAX_LOG_LINES);
        }

        setLogs(uniqueInitialLogs);

        // open WebSocket for real-time updates only if tab is active
        const webSocketURL = API_URL.replace(/^https?/, "ws");
        wsRef.current = new WebSocket(
          `${webSocketURL}/api/pipelines/${pipelineId}/logs/stream`
        );

        wsRef.current.onmessage = (event) => {
          // Set loading to false when we receive the first message
          setIsWebSocketLoading(false);

          const newLogs = event.data.split("\n");

          const newUniqueLogs = newLogs.filter((logLine: string) => {
            // Only keep logs that haven't been added
            return logLine && !logSet.current.has(logLine);
          });

          // Add new unique logs to the set
          newUniqueLogs.forEach((logLine: string) => {
            logSet.current.add(logLine);
          });

          if (newUniqueLogs.length > 0) {
            setLogs(prevLogs => {
              const updatedLogs = [...prevLogs, ...newUniqueLogs];
              // Apply log rotation - keep only the most recent MAX_LOG_LINES
              if (updatedLogs.length > MAX_LOG_LINES) {
                return updatedLogs.slice(updatedLogs.length - MAX_LOG_LINES);
              }
              return updatedLogs;
            });
          }
        };

        wsRef.current.onerror = (error) => {
          console.error("WebSocket error:", error);
          setIsWebSocketLoading(false);
        };

        wsRef.current.onclose = () => {
          console.log("WebSocket connection closed");
          setIsWebSocketLoading(false);
        };
      })
      .catch((error) => {
        console.error("Error fetching initial logs:", error);
        setIsWebSocketLoading(false);
      });

    // Cleanup
    return () => {
      setIsWebSocketLoading(false);
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [activeTabKey, pipelineId]);

  const grepNotificationLog = () => {
    const notificationLog = logs.includes("[Notification Service]") || logs.includes("Notification Service");
    console.log("grepNotificationLog", notificationLog);
    setNotificationLogToggle(!notificationLogToggle);
    // setLogSearchText(notificationLog ? "" : "[Notification Service]");
    setLogSearchText("[Notification Service]");

  }

  const downloadLogFile = async (
    pipelineId: string | undefined,
    pipelineName: string
  ) => {
    setIsLogDownloading(true);

    if (pipelineId === undefined) {
      addNotification(
        "danger",
        t('statusMessage:download.failedTitle'),
        t('statusMessage:download.pipelineLogFail'),
      );
      setIsLogDownloading(false);
      return;
    }

    // Fetch the file as a Blob
    const response = await fetchFile(
      `${API_URL}/api/pipelines/${pipelineId}/logs`
    );

    if ("error" in response) {
      addNotification(
        "danger",
        t('statusMessage:download.failedTitle'),
        t('statusMessage:download.failedDescription', { val: `${pipelineName} : response.error` }),
      );
    } else {
      const url = window.URL.createObjectURL(response);
      const a = document.createElement("a");
      a.href = url;
      a.download = "pipeline.log";
      document.body.appendChild(a);
      a.click();

      // Clean up
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    }

    setIsLogDownloading(false);
  };

  // Listening escape key on full screen mode.
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isFullscreen =
        document.fullscreenElement ||
        (document as ExtendedDocument).mozFullScreenElement ||
        (document as ExtendedDocument).webkitFullscreenElement ||
        (document as ExtendedDocument).msFullscreenElement;

      setIsFullScreen(!!isFullscreen);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("mozfullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
    document.addEventListener("msfullscreenchange", handleFullscreenChange);

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener(
        "mozfullscreenchange",
        handleFullscreenChange
      );
      document.removeEventListener(
        "webkitfullscreenchange",
        handleFullscreenChange
      );
      document.removeEventListener(
        "msfullscreenchange",
        handleFullscreenChange
      );
    };
  }, []);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const onExpandClick = (_event: React.MouseEvent<HTMLElement>) => {
    const element = document.querySelector(
      "#pipeline-log-view"
    ) as ExtendedHTMLElement | null;

    if (element) {
      if (!isFullScreen) {
        if (element.requestFullscreen) {
          element.requestFullscreen();
        } else if (element.mozRequestFullScreen) {
          element.mozRequestFullScreen();
        } else if (element.webkitRequestFullScreen) {
          element.webkitRequestFullScreen();
        } else if (element.msRequestFullscreen) {
          element.msRequestFullscreen();
        }
        setIsFullScreen(true);
      } else {
        const doc = document as ExtendedDocument;
        if (doc.exitFullscreen) {
          doc.exitFullscreen();
        } else if (doc.webkitExitFullscreen) {
          doc.webkitExitFullscreen();
        } else if (doc.msExitFullscreen) {
          doc.msExitFullscreen();
        }
        setIsFullScreen(false);
      }
    }
  };

  const logViewToolbar = (
    <Toolbar>
      <ToolbarContent>

        <ToolbarItem>
          <LogViewerSearch
            placeholder={t('searchPlaceholder')}
            minSearchChars={3}
            {...(notificationLogToggle ? { value: logSearchText } : {})}
          />
        </ToolbarItem>

        <ToolbarItem style={{ marginRight: "10px" }}>
          <Tooltip content={!notificationLogToggle ? t('pipeline:logs.notification.showTooltip') : t('pipeline:logs.notification.hideTooltip')}>
            <Button
              variant="stateful"
              isDisabled={isLogDownloading}
              aria-label="grep notification log"
              icon={<BellIcon />}
              onClick={grepNotificationLog}
              state={!notificationLogToggle ? "read" : "unread"}
            >
              {t('pipeline:logs.notification.grepNotification')}
            </Button>

          </Tooltip>
        </ToolbarItem>

        <ToolbarGroup align={{ default: "alignEnd" }}>
          <ToolbarGroup variant="action-group-plain">
            <ToolbarItem>
              <Tooltip content={t('pipeline:logs.download')}>
                <Button
                  variant="plain"
                  isDisabled={isLogDownloading}
                  aria-label="download log file"
                  icon={<DownloadIcon />}
                  onClick={() => downloadLogFile(pipelineId, pipelineName)}
                />
              </Tooltip>
            </ToolbarItem>

            <ToolbarItem>
              <Tooltip content={t('pipeline:logs.fullScreen')}>
                <Button
                  variant="plain"
                  aria-label="View log viewer in full screen"
                  icon={<ExpandIcon />}
                  onClick={onExpandClick}
                />
              </Tooltip>
            </ToolbarItem>
          </ToolbarGroup>
        </ToolbarGroup>
      </ToolbarContent>
    </Toolbar>
  );

  return (
    <div className="pipeline_log">
      {isWebSocketLoading ? 
      <>
        <Skeleton width="25%" screenreaderText="Loading pipeline log" />
        <br />
        <Skeleton width="33%" />
        <br />
        <Skeleton width="50%" />
        <br />
        <Skeleton width="66%" />
        <br />
        <Skeleton width="75%" />
        <br />
        <Skeleton />
      </> : 
      <LogViewer
        key={activeTabKey}
        {...({ id: "pipeline-log-view" } as
          {
            id: string;
          })}
        hasLineNumbers={false}
        isTextWrapped={false}
        data={logs}
        theme={"light"}
        toolbar={logViewToolbar}
        height={(isFullScreen && "100%") || "calc(100vh - 350px)"}
      />}
    </div>
  );
};

export default PipelineLog;