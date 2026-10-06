import { Card } from "@/shared/components/ui/card";
import { Spinner } from "@/shared/components/ui/spinner";
import React from "react";

const ResetPasswordForm = React.lazy(() => import("./ResetPasswordForm"));

const ResetPasswordPage = () => {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <React.Suspense
        fallback={
          <Card className="w-full sm:max-w-md shadow-lg border-border/40 p-6 flex items-center justify-center">
            <Spinner className="size-6 text-muted-foreground" />
          </Card>
        }
      >
        <ResetPasswordForm />
      </React.Suspense>
    </div>
  );
};

export default ResetPasswordPage;
