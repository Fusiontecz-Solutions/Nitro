const baseUrl = `${import.meta.env.VITE_API_BASE_URL}/decision-logic`;

function apiErrorMessage(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const o = body as Record<string, unknown>;
  const msg =
    (typeof o.message === "string" && o.message) ||
    (o.error &&
      typeof o.error === "object" &&
      typeof (o.error as { description?: string }).description === "string" &&
      (o.error as { description: string }).description) ||
    undefined;
  return msg ? String(msg) : undefined;
}

async function parseJsonSafely(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function extractDecisionLogicRequestCode(payload: any): string {
  const direct = String(payload?.requestCode ?? "").trim();
  if (direct) return direct;
  const nested = String(payload?.requestCode?.data?.requestCode ?? "").trim();
  if (nested) return nested;
  const alt = String(payload?.data?.requestCode ?? "").trim();
  if (alt) return alt;
  return "";
}

export async function initiateDecisionLogic(
  clientId: number,
  ownerId: number,
  bankAccountId: number
) {
  try {
    const response = await fetch(`${baseUrl}/initiate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        businessOwnerId: ownerId,
        bankAccountId: bankAccountId,
      }),
    });

    if (!response.ok) {
      const errorData = await parseJsonSafely(response);
      throw new Error(
        apiErrorMessage(errorData) || "Unknown server error",
      );
    }

    return await response.json();
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "An unknown error occurred.",
    };
  }
}

export async function verifyDecisionLogicToken(token: string) {
  try {
    const response = await fetch(`${baseUrl}/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ token }),
    });

    if (response.ok) {
      return await response.json();
    } else {
      const errorData = await parseJsonSafely(response);
      throw new Error(
        apiErrorMessage(errorData) || "Token verification failed.",
      );
    }
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "An unexpected error occurred.",
    };
  }
}

export async function generateDecisionLogicRequestCode(
  businessOwnerId: number,
  bankAccountId: number
) {
  try {
    const response = await fetch(`${baseUrl}/request-code`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        businessOwnerId,
        bankAccountId,
      }),
    });

    if (!response.ok) {
      const errorData = await parseJsonSafely(response);
      throw new Error(
        apiErrorMessage(errorData) ||
          `Decision Logic request-code failed (HTTP ${response.status}).`,
      );
    }

    const responseData = await response.json();

    const requestCode = extractDecisionLogicRequestCode(responseData);
    if (!requestCode) {
      throw new Error(
        responseData?.requestCode?.errorMessage ||
          responseData?.message ||
          "Request code generation failed."
      );
    }

    return {
      requestCode,
      raw: responseData,
    };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "An unknown error occurred. Please try again later.",
    };
  }
}

export async function generateDecisionLogicReport(
  requestCode: string,
  businessOwnerId: number,
  bankAccountId: number
) {
  try {
    const response = await fetch(`${baseUrl}/generate-report`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requestCode: requestCode,
        businessOwnerId: businessOwnerId,
        bankAccountId: bankAccountId,
      }),
    });

    if (!response.ok) {
      const errorBody = await parseJsonSafely(response);
      throw new Error(
        apiErrorMessage(errorBody) || "Failed to generate Decision Logic report.",
      );
    }

    return await response.json();
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error?.message
        : "An unexpected error occurred while processing the request. Please try again later.";

    return { error: errorMessage };
  }
}

export async function fetchDecisionLogicReport(
  clientId: number,
  ownerId: number
) {
  try {
    const response = await fetch(
      `${baseUrl}/report?businessOwnerId=${ownerId}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      const errorBody = await parseJsonSafely(response);
      throw new Error(
        apiErrorMessage(errorBody) || "Failed to fetch report.",
      );
    }

    return await response.json();
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : "An unexpected error occurred while processing the request. Please try again later.";

    return { error: errorMessage };
  }
}
