

// @ts-nocheck
import { describe, expect, test, mock, beforeEach, afterEach, spyOn } from "bun:test";

import { ConvexError } from "convex/values";



// Mock @polar-sh/sdk

const mockCustomersCreate = mock();

const mockCheckoutsCreate = mock();

const mockCustomerSessionsCreate = mock();



mock.module("@polar-sh/sdk", () => {

    return {

        Polar: class {

            customers = { create: mockCustomersCreate };

            checkouts = { create: mockCheckoutsCreate };

            customerSessions = { create: mockCustomerSessionsCreate };

        }

    };

});



// We don't need to mock @convex-dev/polar module if we can mock the instance method

// But since the instance is created at module level, mocking the module is cleaner if it works.

// Since it didn't work, we will try to modify the instance.







import { getUserInfoHandler, createCheckoutLinkHandler, createCustomerPortalHandler, polar, polarUserInfoProvider } from "./billing";







const mockGetCurrentSubscription = mock();



// Overwrite the method on the exported instance



polar.getCurrentSubscription = mockGetCurrentSubscription;







describe("billing", () => {



    beforeEach(() => {



        mockCustomersCreate.mockReset();



        mockCheckoutsCreate.mockReset();



        mockCustomerSessionsCreate.mockReset();



        mockGetCurrentSubscription.mockReset();



    });







    describe("getUserInfo", () => {



        test("returns user if authenticated", async () => {



            const user = { subject: "u1", email: "e@mail.com" };



            const ctx = { auth: { getUserIdentity: mock().mockResolvedValue(user) } };



            const result = await getUserInfoHandler(ctx);



            expect(result).toEqual(user);



        });







        test("throws if not authenticated", async () => {



            const ctx = { auth: { getUserIdentity: mock().mockResolvedValue(null) } };



            expect(getUserInfoHandler(ctx)).rejects.toThrow(ConvexError);



        });



    });







    describe("polarUserInfoProvider", () => {



        test("returns user info", async () => {



            const user = { subject: "u1", email: "e@mail.com" };



            const ctx = { runQuery: mock().mockResolvedValue(user) };



            const result = await polarUserInfoProvider(ctx);



            expect(result).toEqual({ userId: "u1", email: "e@mail.com" });



        });







        test("throws if user email missing", async () => {



            const user = { subject: "u1" };



            const ctx = { runQuery: mock().mockResolvedValue(user) };



            expect(polarUserInfoProvider(ctx)).rejects.toThrow(ConvexError);



        });



    });







    describe("createCheckoutLink", () => {



        let ctx: any;



        const user = { subject: "u1", email: "e@mail.com" };







        beforeEach(() => {



            ctx = {



                runQuery: mock().mockResolvedValue(user),



                runMutation: mock().mockResolvedValue(null),



            };



        });







        test("creates customer if not exists and creates checkout", async () => {



            // fix: first call is getUserInfo, second is getCustomerByUserId



            ctx.runQuery.mockResolvedValueOnce(user)



                .mockResolvedValueOnce(null);







            mockCustomersCreate.mockResolvedValue({ id: "cust_1" });



            mockCheckoutsCreate.mockResolvedValue({ url: "https://checkout" });







            const url = await createCheckoutLinkHandler(ctx, { productId: "prod_1" });







            expect(mockCustomersCreate).toHaveBeenCalled();



            expect(ctx.runMutation).toHaveBeenCalled(); // insertCustomer



            expect(mockCheckoutsCreate).toHaveBeenCalledWith(expect.objectContaining({



                customerId: "cust_1",



                products: ["prod_1"]



            }));



            expect(url).toBe("https://checkout");



        });







        test("uses existing customer", async () => {



            ctx.runQuery.mockResolvedValueOnce(user)



                .mockResolvedValueOnce({ id: "cust_existing" });







            mockCheckoutsCreate.mockResolvedValue({ url: "https://checkout" });







            const url = await createCheckoutLinkHandler(ctx, { productId: "prod_1" });







            expect(mockCustomersCreate).not.toHaveBeenCalled();



            expect(ctx.runMutation).not.toHaveBeenCalled();



            expect(mockCheckoutsCreate).toHaveBeenCalledWith(expect.objectContaining({



                customerId: "cust_existing"



            }));



            expect(url).toBe("https://checkout");



        });







        test("throws if customer creation fails", async () => {



            ctx.runQuery.mockResolvedValueOnce(user)



                .mockResolvedValueOnce(null);







            mockCustomersCreate.mockResolvedValue({ id: undefined }); // Creation failed







            expect(createCheckoutLinkHandler(ctx, { productId: "prod_1" })).rejects.toThrow("Customer not created");



        });



    });





    describe("createCustomerPortal", () => {
        let ctx: any;
        const user = { subject: "u1", email: "e@mail.com" };

        beforeEach(() => {
            ctx = {
                runQuery: mock().mockResolvedValue(user),
            };
        });

        test("creates portal session if subscription exists", async () => {
            // Verify mock is working
            console.log("Mock setup called");
            mockGetCurrentSubscription.mockResolvedValue({ customerId: "cust_1" });
            mockCustomerSessionsCreate.mockResolvedValue({ customerPortalUrl: "https://portal" });

            const url = await createCustomerPortalHandler(ctx);

            expect(url).toBe("https://portal");
            expect(mockCustomerSessionsCreate).toHaveBeenCalledWith({ customerId: "cust_1" });
        });

        test("throws if no subscription", async () => {
            mockGetCurrentSubscription.mockResolvedValue(null);
            expect(createCustomerPortalHandler(ctx)).rejects.toThrow(ConvexError);
        });
    });
});
