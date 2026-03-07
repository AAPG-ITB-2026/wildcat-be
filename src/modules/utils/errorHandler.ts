import type { Context } from "hono";

export const handleApiError = (err: any, c: Context) => {
    if (err.name === 'ZodError'){
        return c.json({
            success: false,
            errors: err.flatten()
        },400)
    }

    // resource already exists
    if (err.code === '23505') {
        return c.json({
            success: false,
            message: 'Resource already exists' // handle actual message in frontend?
        }), 409
    }

    return c.json({success: false, message: "Internal Server Error"}, 500)
}
