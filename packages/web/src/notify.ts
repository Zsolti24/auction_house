import { toast, type ToastOptions } from "react-toastify";

/**
 * Toasts for user feedback, shown in addition to the inline messages (which stay on the page
 * after the toast fades). Pass an `id` for feedback that can fire repeatedly (outbid, connection),
 * so a burst of updates — or React StrictMode running an effect twice — shows one toast, not many.
 */
const withId = (id?: string): ToastOptions => (id ? { toastId: id } : {});

export const notify = {
  success: (message: string, id?: string) => toast.success(message, withId(id)),
  error: (message: string, id?: string) => toast.error(message, withId(id)),
  warning: (message: string, id?: string) => toast.warning(message, withId(id)),
  info: (message: string, id?: string) => toast.info(message, withId(id)),
  dismiss: (id: string) => toast.dismiss(id),
};
