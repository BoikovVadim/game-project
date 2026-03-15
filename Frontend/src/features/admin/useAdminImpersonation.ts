import { useCallback } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { setAdminImpersonationSession } from "../../api/authClient.ts";

type UseAdminImpersonationArgs = {
  token: string;
  setError: (value: string) => void;
};

export function useAdminImpersonation({
  token,
  setError,
}: UseAdminImpersonationArgs) {
  const navigate = useNavigate();

  return useCallback(
    async (userId: number) => {
      setError("");
      try {
        const headers = { Authorization: `Bearer ${token}` };
        const res = await axios.post<{ access_token: string }>(
          "/admin/impersonate",
          { userId },
          { headers },
        );
        const newToken = res.data?.access_token;
        if (newToken) {
          const currentAdminHash =
            window.location.hash && window.location.hash.startsWith("#/")
              ? window.location.hash
              : "#/admin?tab=users";
          setAdminImpersonationSession(token, newToken, currentAdminHash);
          navigate("/profile");
          window.location.reload();
        }
      } catch (e: any) {
        setError(
          e?.response?.data?.message || "Не удалось войти под пользователем",
        );
      }
    },
    [navigate, setError, token],
  );
}
