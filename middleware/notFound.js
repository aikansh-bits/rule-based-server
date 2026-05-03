import { createResponse } from "../utils/helper.js";

export const notFound = (req, res) => {
  res.status(404).json(
    createResponse({
      success: false,
      message: `No route matches ${req.method} ${req.path}`,
      meta: { requestId: req.id },
    }),
  );
};
