import { Card } from "@/shared/components/ui/card";
import { Spinner } from "@/shared/components/ui/spinner";
import React from "react";

const LoginFormContent = React.lazy(() => import("./LoginForm"));

const LoginPage = () => {
  return (
    <div className="flex h-screen items-center justify-center">
      <React.Suspense
        fallback={
          <Card className="w-full sm:max-w-md shadow-lg border-border/40 p-6 flex items-center justify-center">
            <Spinner className="size-6 text-muted-foreground" />
          </Card>
        }
      >
        <LoginFormContent />
      </React.Suspense>
    </div>
  );
};

export default LoginPage;
